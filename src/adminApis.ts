// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import { defineConfig, getWholeConfig, setConfig } from './config'
import { getServerStatus, getUrls } from './listen'
import {
    API_VERSION,
    BUILD_TIMESTAMP,
    COMPATIBLE_API_VERSION,
    HFS_STARTED,
    IS_WINDOWS,
    VERSION,
    HTTP_UNAUTHORIZED, HTTP_NOT_FOUND, HTTP_BAD_REQUEST, HTTP_SERVER_ERROR, HTTP_FORBIDDEN
} from './const'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import pluginsApis from './api.plugins'
import monitorApis from './api.monitor'
import langApis from './api.lang'
import { getConnections } from './connections'
import { debounceAsync, isLocalHost, makeNetMatcher, onOff, waitFor } from './misc'
import events from './events'
import { accountCanLoginAdmin, accountsConfig, getFromAccount } from './perm'
import Koa from 'koa'
import { getProxyDetected } from './middlewares'
import { writeFile } from 'fs/promises'
import { createReadStream } from 'fs'
import * as readline from 'readline'
import { loggers } from './log'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { customHtmlSections, customHtmlState, saveCustomHtml } from './customHtml'
import _ from 'lodash'
import { getUpdate, localUpdateAvailable, update, updateSupported } from './update'

export const adminApis: ApiHandlers = {

    ...vfsApis,
    ...accountsApis,
    ...pluginsApis,
    ...monitorApis,
    ...langApis,

    async set_config({ values: v }) {
        if (v) {
            await setConfig(v)
            if (v.port === 0 || v.https_port === 0)
                return await waitFor(async () => {
                    const st = await getServerStatus()
                    // wait for all random ports to be done, so we communicate new numbers
                    if ((v.port !== 0 || st.http.listening)
                    && (v.https_port !== 0 || st.https.listening))
                        return st
                }, { timeout: 1000 })
                    ?? new ApiError(HTTP_SERVER_ERROR, "something went wrong changing ports")
        }
        return {}
    },

    get_config: getWholeConfig,
    update,
    check_update: () => getUpdate().then(x => _.pick(x, 'name')),

    get_custom_html() {
        return {
            sections: Object.fromEntries([
                ...customHtmlSections.map(k => [k,'']),
                ...customHtmlState.sections
            ])
        }
    },

    async set_custom_html({ sections }) {
        await saveCustomHtml(sections)
        return {}
    },

    quit() {
        setTimeout(() => process.exit())
        return {}
    },

    async get_status() {
        return {
            started: HFS_STARTED,
            build: BUILD_TIMESTAMP,
            version: VERSION,
            apiVersion: API_VERSION,
            compatibleApiVersion: COMPATIBLE_API_VERSION,
            ...await getServerStatus(),
            urls: getUrls(),
            update: !updateSupported() ? false : await localUpdateAvailable() ? 'local' : true,
            proxyDetected: getProxyDetected(),
            frpDetected: localhostAdmin.get() && !getProxyDetected()
                && getConnections().every(isLocalHost)
                && await frpDebounced(),
        }
    },

    async save_pem({ cert, private_key, name='self' }) {
        if (!cert || !private_key)
            return new ApiError(HTTP_BAD_REQUEST)
        const files = { cert: name + '.cert', private_key: name + '.key' }
        await writeFile(files.private_key, private_key)
        await writeFile(files.cert, cert)
        return files
    },

    async get_log({ file='log' }, ctx) {
        return new SendListReadable({
            bufferTime: 10,
            doAtStart(list) {
                const logger = loggers.find(l => l.name === file)
                if (!logger)
                    return list.error(HTTP_NOT_FOUND, true)
                const input = createReadStream(logger.path)
                input.on('error', async (e: any) => {
                    if (e.code === 'ENOENT') // ignore ENOENT, consider it an empty log
                        return list.ready()
                    list.error(e.code || e.message)
                })
                input.on('end', () =>
                    list.ready())
                input.on('ready', () => {
                    readline.createInterface({ input }).on('line', line => {
                        if (ctx.aborted)
                            return input.close()
                        const obj = parse(line)
                        if (obj)
                            list.add(obj)
                    }).on('close', () => { // file is automatically closed, so we continue by events
                        ctx.res.once('close', onOff(events, { // unsubscribe when connection is interrupted
                            [logger.name](entry) {
                                list.add(entry)
                            }
                        }))
                    })
                })
            }
        })

        function parse(line: string) {
            const m = /^(.+?) (.+?) (.+?) \[(.{11}):(.{14})] "(\w+) ([^"]+) HTTP\/\d.\d" (\d+) (-|\d+)/.exec(line)
            if (!m) return
            const [, ip, , user, date, time, method, uri, status, length] = m
            return { // keep object format same as events emitted by the log module
                ip,
                user: user === '-' ? undefined : user,
                ts: new Date(date + ' ' + time),
                method,
                uri,
                status: Number(status),
                length: length === '-' ? undefined : Number(length),
            }
        }
    },
}

for (const [k, was] of Object.entries(adminApis))
    adminApis[k] = (params, ctx) => {
        if (!allowAdmin(ctx))
            return new ApiError(HTTP_FORBIDDEN)
        if (ctxAdminAccess(ctx))
            return was(params, ctx)
        const props = { any: anyAccountCanLoginAdmin() }
        return ctx.headers.accept === 'text/event-stream'
            ? new SendListReadable({ doAtStart: x => x.error(HTTP_UNAUTHORIZED, true, props) })
            : new ApiError(HTTP_UNAUTHORIZED, props)
    }

export const localhostAdmin = defineConfig('localhost_admin', true)
export const adminNet = defineConfig('admin_net', '', v => makeNetMatcher(v, true) )
export const favicon = defineConfig('favicon', '')
export const title = defineConfig('title', "File server")

export function ctxAdminAccess(ctx: Koa.Context) {
    return !ctx.ips.length // we consider localhost_admin only if no proxy is being usedø
        && localhostAdmin.get() && isLocalHost(ctx)
        || getFromAccount(ctx.state.account, a => a.admin)
}

const frpDebounced = debounceAsync(async () => {
    if (!IS_WINDOWS) return false
    const { stdout } = await promisify(execFile)('tasklist', ['/fi','imagename eq frpc.exe','/nh'])
    return stdout.includes('frpc')
})

export function anyAccountCanLoginAdmin() {
    return Boolean(_.find(accountsConfig.get(), accountCanLoginAdmin))
}

export function allowAdmin(ctx: Koa.Context) {
    return adminNet.compiled()(ctx.ip)
}