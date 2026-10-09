// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { isNativeError } from 'node:util/types'
import createSSE from './sse'
import { pipeline, Readable } from 'stream'
import { CFG, Promisable } from './misc'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FOOL, PLUGIN_CUSTOM_REST_PREFIX } from './const'
import { defineConfig } from './config'
import { firstPlugin, mapPlugins, Plugin } from './plugins'
import { ApiError } from './ApiError'
import { SendListReadable } from './SendList'

export { ApiError } from './ApiError'
type ApiHandlerResult = Record<string,any> | ApiError | Readable | AsyncGenerator<any> | null
// allow defining extra parameters that can be used when an api to invoke another (like copy_files)
export type ApiHandler = (params:any, ctx:Koa.Context, ...ignore: unknown[]) => Promisable<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

const logApi = defineConfig(CFG.log_api, true)

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx) => {
        if (!logApi.get())
            ctx.state.dontLog = true
        const isPost = ctx.state.params
        const params = isPost ? ctx.state.params || {} : ctx.query
        const apiName = ctx.path
        console.debug('API', ctx.method, apiName, { ...params })
        const csrfSafe = ctx.get('x-hfs-anti-csrf') // automatic browser actions won't carry this header
            || apiName.startsWith('get_') // "get_" apis are safe because they make no change
            || /^(curl|wget|python|go-|java|axios|postman|httpie|insomnia|bruno)/i.test(ctx.get('user-agent') || '') // only browser are subject to CSRF
        if (!csrfSafe)
            return send(HTTP_FOOL, "missing header x-hfs-anti-csrf:1")
        const customApiRest = apiName.startsWith(PLUGIN_CUSTOM_REST_PREFIX) && apiName.slice(PLUGIN_CUSTOM_REST_PREFIX.length)
        const customApiFun = customApiRest && resolveCustomRest(customApiRest)
        if (customApiFun instanceof ApiError)
            return send(customApiFun.status, customApiFun.message)
        const apiFun = customApiFun
            || apis.hasOwnProperty(apiName) && apis[apiName]!
        if (!apiFun)
            return send(HTTP_BAD_REQUEST, 'invalid api')
        // we don't rely on SameSite cookie option because it's https-only
        let res
        try {
            res = await apiFun(params, ctx)
            if (isNativeError(res)) throw res
            if (res === null) return
            // return the initial list as regular JSON when the caller did not request live updates
            if (res instanceof SendListReadable && ctx.get('accept') !== 'text/event-stream')
                res = await res.collectInitial()
        }
        catch (error) {
            const { status, message } = ApiError.from(error)
            return send(status, message)
        }
        if (isAsyncGenerator(res))
            res = Readable.from(res)
        if (res instanceof Readable) { // Readable, we'll go SSE-mode
            // forward late failures and close the generator if the HTTP response is abandoned
            pipeline(res, createSSE(ctx), error => {
                if (error && !ctx.res.destroyed) ctx.res.destroy(error)
            })
            return
        }
        ctx.body = res

        function send(status: number, body?: string) {
            ctx.body = body
            ctx.status = status
        }
    }
}

function resolveCustomRest(request: string) {
    const separator = request.lastIndexOf(':')
    if (separator > 0) {
        const selector = request.slice(0, separator)
        const name = request.slice(separator + 1)
        const matches = mapPlugins((plugin, id) => {
            if (matchesSelector(plugin, id, selector)) return plugin
        })
        if (matches.length > 1)
            return new ApiError(HTTP_CONFLICT, `ambiguous plugin selector: ${selector}`)
        const match = matches[0]
        const targeted = match?.getData().customRest?.[name]
        if (targeted) return targeted
    }
    return firstPlugin(plugin => plugin.getData().customRest?.[request])
}

function matchesSelector(plugin: Readonly<Plugin>, id: string, selector: string) {
    const declared = plugin.repo
    const repo = typeof declared === 'string' ? declared : declared?.main
    return selector === id || selector === repo
}

function isAsyncGenerator(x: any): x is AsyncGenerator {
    return typeof (x as AsyncGenerator)?.next === 'function'
}
