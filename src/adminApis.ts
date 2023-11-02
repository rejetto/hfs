// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import { configFile, defineConfig, getWholeConfig, setConfig } from './config'
import { getBaseUrlOrDefault, getIps, getServerStatus, getUrls } from './listen'
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
import netApis from './api.net'
import { getConnections } from './connections'
import { apiAssertTypes, debounceAsync, isLocalHost, makeNetMatcher, onOff, tryJson, wait, waitFor } from './misc'
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
import { getUpdates, localUpdateAvailable, update, updateSupported } from './update'
import { consoleLog } from './consoleLog'
import { resolve } from 'path'
import { getErrorSections } from './errorPages'

export const adminApis: ApiHandlers = {

    ...vfsApis,
    ...accountsApis,
    ...pluginsApis,
    ...monitorApis,
    ...langApis,
    ...netApis,

    async set_config({ values }) {
        apiAssertTypes({ object: { values } })
        setConfig(values)
        if (values.port === 0 || values.https_port === 0)
            return await waitFor(async () => {
                const st = await getServerStatus()
                // wait for all random ports to be done, so we communicate new numbers
                if ((values.port !== 0 || st.http.listening)
                && (values.https_port !== 0 || st.https.listening))
                    return st
            }, { timeout: 1000 })
                ?? new ApiError(HTTP_SERVER_ERROR, "something went wrong changing ports")
        return {}
    },

    get_config: getWholeConfig,
    get_config_text() {
        return {
            path: configFile.getPath(),
            fullPath: resolve(configFile.getPath()),
            text: configFile.getText(),
        }
    },
    set_config_text: ({ text }) => configFile.save(text, { reparse: true }),
    update: ({ tag }) => update(tag),
    async check_update() {
        return { options: await getUpdates() }
    },

    get_custom_html() {
        return {
            sections: Object.fromEntries([
                ...customHtmlSections.concat(getErrorSections()).map(k => [k,'']),
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
            ...await getServerStatus(false),
            platform: process.platform,
            urls: await getUrls(),
            ips: await getIps(false),
            baseUrl: getBaseUrlOrDefault(),
            updatePossible: !updateSupported() ? false : await localUpdateAvailable() ? 'local' : true,
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

    get_log({ file='log' }, ctx) {
        return new SendListReadable({
            bufferTime: 10,
            async doAtStart(list) {
                if (file === 'console') {
                    for (const chunk of _.chunk(consoleLog, 1000)) { // avoid occupying the thread too long
                        for (const x of chunk)
                            list.add(x)
                        await wait(0)
                    }
                    list.ready()
                    events.on('console', x => list.add(x))
                    return
                }
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
            const m = /^(.+?) (.+?) (.+?) \[(.{11}):(.{14})] "(\w+) ([^"]+) HTTP\/\d.\d" (\d+) (-|\d+) ?(.*)/.exec(line)
            if (!m) return
            const [, ip, , user, date, time, method, uri, status, length, extra] = m
            return { // keep object format same as events emitted by the log module
                ip,
                user: user === '-' ? undefined : user,
                ts: new Date(date + ' ' + time),
                method,
                uri,
                status: Number(status),
                length: length === '-' ? undefined : Number(length),
                extra: tryJson(tryJson(extra)) || undefined,
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
        const props = { possible: anyAccountCanLoginAdmin() }
        return ctx.headers.accept === 'text/event-stream'
            ? new SendListReadable({ doAtStart: x => x.error(HTTP_UNAUTHORIZED, true, props) })
            : new ApiError(HTTP_UNAUTHORIZED, props)
    }

export const localhostAdmin = defineConfig('localhost_admin', true)
export const adminNet = defineConfig('admin_net', '', v => makeNetMatcher(v, true) )
export const favicon = defineConfig('favicon', '')
export const title = defineConfig('title', "File server")

export function ctxAdminAccess(ctx: Koa.Context) {
    return !ctx.ips.length // we consider localhost_admin only if no proxy is being used
        && localhostAdmin.get() && isLocalHost(ctx)
        || getFromAccount(ctx.state.account, a => a.admin)
}

const frpDebounced = debounceAsync(async () => {
    if (!IS_WINDOWS) return false
    try { // guy with win11 reported missing tasklist, so don't take it for granted
        const { stdout } = await promisify(execFile)('tasklist', ['/fi','imagename eq frpc.exe','/nh'])
        return stdout.includes('frpc')
    }
    catch {
        return false
    }
})

export function anyAccountCanLoginAdmin() {
    return Boolean(_.find(accountsConfig.get(), accountCanLoginAdmin))
}

export function allowAdmin(ctx: Koa.Context) {
    return adminNet.compiled()(ctx.ip)
}