// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { defineConfig, getWholeConfig, setConfig } from './config'
import { getStatus, getUrls, httpsPortCfg, portCfg } from './listen'
import { API_VERSION, BUILD_TIMESTAMP, COMPATIBLE_API_VERSION, FORBIDDEN, HFS_STARTED, IS_WINDOWS, VERSION } from './const'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import pluginsApis from './api.plugins'
import monitorApis from './api.monitor'
import { getConnections } from './connections'
import { debounceAsync, isLocalHost, onOff } from './misc'
import _ from 'lodash'
import events from './events'
import { getFromAccount } from './perm'
import Koa from 'koa'
import { Readable } from 'stream'
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
            http: serverStatus(st.httpSrv, portCfg.get()),
            https: serverStatus(st.httpsSrv, httpsPortCfg.get()),
            urls: getUrls(),
            proxyDetected: getProxyDetected(),
            frpDetected: localhostAdmin.get() && !getProxyDetected()
                && getConnections().every(isLocalHost)
                && await frpDebounced(),
        }

        function serverStatus(h: typeof st.httpSrv, configuredPort?: number) {
            return {
                ..._.pick(h, ['listening', 'busy', 'error']),
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

    async get_log({ file }, ctx) {
        const logger = loggers.find(l => l.name === file)
        if (!logger)
            return new ApiError(404)
        const ret = new Readable({ objectMode: true, read(){} })
        const input = createReadStream(logger.path)
        readline.createInterface({ input }).on('line', line => {
            if (ctx.aborted)
                return input.close()
            ret.push({ add: parse(line) })
        }).on('close', () =>  // file is automatically closed, so we continue by events
            ctx.res.once('close', onOff(events, { // unsubscribe when connection is interrupted
                [logger.name](entry) {
                    ret.push({ add: entry })
                }
            })))

        return ret

        function parse(line: string) {
            const m = /^(.+) - - \[(.{11}):(.{14})] "(\w+) ([^"]+) HTTP\/\d.\d" (\d+) (.+)$/.exec(line)
            return m && { // keep object format same as events emitted by the log module
                ip: m[1],
                ts: new Date(m[2] + ' ' + m[3]),
                method: m[4],
                uri: m[5],
                code: Number(m[6]),
                size: m[7] === '-' ? undefined : Number(m[7])
            }
        }
    },
}

for (const k in adminApis) {
    const was = adminApis[k]
    adminApis[k] = (params, ctx) =>
        ctxAdminAccess(ctx) ? was(params, ctx)
            : new ApiError(401)
}

export const localhostAdmin = defineConfig('localhost_admin', true)

export function ctxAdminAccess(ctx: Koa.Context) {
    return isLocalHost(ctx) && localhostAdmin.get()
            && !ctx.state.proxiedFor // this may detect an http-proxied request on localhost
        || getFromAccount(ctx.state.account, a => a.admin)
}

const frpDebounced = debounceAsync(async () => {
    if (!IS_WINDOWS) return false
    const { stdout } = await promisify(execFile)('tasklist', ['/fi','imagename eq frpc.exe','/nh'])
    return stdout.includes('frpc')
})
