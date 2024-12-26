// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import https from 'node:https'
import http, { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { parse } from 'node:url'
import _ from 'lodash'
import { defineConfig } from './config'
import { text as stream2string, buffer } from 'node:stream/consumers'
import { reg } from './util-os'
import events from './events'
import { IS_WINDOWS } from './const'
import { prefix } from './cross'
export { stream2string }

const outboundProxy = defineConfig('outbound_proxy', '', v => {
    try {
        parse(v)
        return v
    }
    catch {
        console.warn("invalid URL", v)
        return ''
    }
})

events.once('configReady', async startedWithoutConfig => {
    if (!IS_WINDOWS || !startedWithoutConfig) return
    // try to read Windows system setting for proxy
    const out = await reg('query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings')
    if (!/ProxyEnable.+(\d)/.exec(out)?.[1]) return
    const read = /ProxyServer.+?([\d:.]+)/.exec(out)?.[1]
    if (!read) return
    // it can be like "IP:PORT" or "http=IP:PORT;https=IP:PORT;ftp=IP:PORT"
    const url = prefix('https://', /https=([\d:.]+)/.exec(out)?.[1]) // prefer https
        || prefix('http://', /http=([\d:.]+)/.exec(out)?.[1])
        || !read.includes('=') && 'http://' + read // simpler form
    if (!url) return
    outboundProxy.set(url)
    console.log("detected proxy", read)
})

export async function httpString(url: string, options?: XRequestOptions): Promise<string> {
    return await stream2string(await httpStream(url, options))
}

export async function httpWithBody(url: string, options?: XRequestOptions): Promise<IncomingMessage & { ok: boolean, body: Buffer | undefined }> {
    const req = await httpStream(url, options)
    return Object.assign(req, {
        ok: _.inRange(req.statusCode!, 200, 300),
        body: req.statusCode ? await buffer(req) : undefined,
    })
}

export interface XRequestOptions extends https.RequestOptions {
    body?: string | Buffer | Readable
    proxy?: string // url format
    // basic cookie store
    jar?: Record<string, string>
    noRedirect?: boolean
    // throw for http-level errors. Default is true.
    httpThrow?: boolean
}

export function httpStream(url: string, { body, jar, noRedirect, httpThrow, proxy, ...options }: XRequestOptions ={}): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        proxy ??= outboundProxy.compiled()
        options.headers ??= {}
        if (body) {
            options.method ||= 'POST'
            if (_.isPlainObject(body)) {
                options.headers['content-type'] ??= 'application/json'
                body = JSON.stringify(body)
            }
            if (!(body instanceof Readable))
                options.headers['content-length'] ??= Buffer.byteLength(body)
        }
        if (jar)
            options.headers.cookie = _.map(jar, (v,k) => `${k}=${v}; `).join('')
                + (options.headers.cookie || '') // preserve parameter
        Object.assign(options, _.pick(parse(proxy || url), ['hostname', 'port', 'path', 'protocol']))
        if (proxy) {
            options.path = url
            options.headers.host ??= parse(url).host || undefined
        }
        const proto = options.protocol === 'https:' ? https : http
        const req = proto.request(options, res => {
            console.debug("http responded", res.statusCode, "to", url)
            if (jar) for (const entry of res.headers['set-cookie'] || []) {
                const [, k, v] = /(.+?)=([^;]+)/.exec(entry) || []
                if (!k) continue
                if (v) jar[k] = v
                else delete jar[k]
            }
            if (!res.statusCode || (httpThrow ?? true) && res.statusCode >= 400)
                return reject(new Error(String(res.statusCode), { cause: res }))
            let r = res.headers.location
            if (r && !noRedirect) {
                if (r.startsWith('/')) // relative
                    r = /(.+)\b\/(\b|$)/.exec(url)?.[1] + r
                const stack = ((options as any)._stack ||= [])
                if (stack.length > 20 || stack.includes(r))
                    return reject(new Error('endless http redirection'))
                stack.push(r)
                return resolve(httpStream(r, options))
            }
            resolve(res)
        }).on('error', e => {
            reject((req as any).res || e)
        })
        if (body && body instanceof Readable)
            body.pipe(req).on('end', () => req.end())
        else
            req.end(body)
    })
}

