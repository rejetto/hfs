// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import { defineConfig, getWholeConfig, setConfig } from './config'
import { getStatus, getUrls, httpsPortCfg, portCfg } from './listen'
import {
    API_VERSION,
    BUILD_TIMESTAMP,
    COMPATIBLE_API_VERSION,
    FORBIDDEN,
    HFS_STARTED,
    IS_WINDOWS,
    UNAUTHORIZED,
    VERSION
} from './const'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import pluginsApis from './api.plugins'
import monitorApis from './api.monitor'
import { getConnections } from './connections'
import { debounceAsync, isLocalHost, onOff, wait } from './misc'
import _ from 'lodash'
import events from './events'
import { getFromAccount } from './perm'
import Koa from 'koa'
import { getProxyDetected } from './middlewares'
import { writeFile } from 'fs/promises'
import { createReadStream } from 'fs'
import * as readline from 'readline'
import { loggers } from './log'
import { execFile } from 'child_process'
import { promisify } from 'util'

export const adminApis: ApiHandlers = {

    ...vfsApis,
    ...accountsApis,
    ...pluginsApis,
    ...monitorApis,

    async set_config({ values: v }) {
        if (v) {
            const st = getStatus()
            const noHttp = (v.port ?? portCfg.get()) < 0 || !st.httpSrv.listening
            const noHttps = (v.https_port ?? httpsPortCfg.get()) < 0 || !st.httpsSrv.listening
            if (noHttp && noHttps)
                return new ApiError(FORBIDDEN, "You cannot switch off both http and https ports")
            await setConfig(v)
        }
        return {}
    },

    get_config: getWholeConfig,

    async get_status() {
        const st = getStatus()
        return {
            started: HFS_STARTED,
            build: BUILD_TIMESTAMP,
            version: VERSION,
            apiVersion: API_VERSION,
            compatibleApiVersion: COMPATIBLE_API_VERSION,
            http: await serverStatus(st.httpSrv, portCfg.get()),
            https: await serverStatus(st.httpsSrv, httpsPortCfg.get()),
            urls: getUrls(),
            proxyDetected: getProxyDetected(),
            frpDetected: localhostAdmin.get() && !getProxyDetected()
                && getConnections().every(isLocalHost)
                && await frpDebounced(),
        }

        async function serverStatus(h: typeof st.httpSrv, configuredPort?: number) {
            const busy = await h.busy
            await wait(0) // simple trick to wait for also .error to be updated. If this trickery becomes necessary elsewhere, then we should make also error a Promise.
            return {
                ..._.pick(h, ['listening', 'error']),
                busy,
                port: (h?.address() as any)?.port || configuredPort,
            }
        }
    },

    async save_pem({ cert, private_key, name='self' }) {
        if (!cert || !private_key)
            return new ApiError(400)
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
                    return list.error(404, true)
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

for (const k in adminApis) {
    const was = adminApis[k]
    adminApis[k] = (params, ctx) =>
        ctxAdminAccess(ctx) ? was(params, ctx)
            : new ApiError(UNAUTHORIZED)
}

export const localhostAdmin = defineConfig('localhost_admin', true)

export function ctxAdminAccess(ctx: Koa.Context) {
    return !ctx.state.proxiedFor // we consider localhost_admin only if no proxy is detected
        && localhostAdmin.get() && isLocalHost(ctx)
        || getFromAccount(ctx.state.account, a => a.admin)
}

const frpDebounced = debounceAsync(async () => {
    if (!IS_WINDOWS) return false
    const { stdout } = await promisify(execFile)('tasklist', ['/fi','imagename eq frpc.exe','/nh'])
    return stdout.includes('frpc')
})
