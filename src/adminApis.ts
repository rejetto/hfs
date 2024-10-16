// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandler, ApiHandlers } from './apiMiddleware'
import { configFile, defineConfig, getWholeConfig, setConfig } from './config'
import { getBaseUrlOrDefault, getIps, getServerStatus, getUrls } from './listen'
import {
    API_VERSION,
    BUILD_TIMESTAMP,
    COMPATIBLE_API_VERSION,
    HFS_STARTED,
    IS_WINDOWS,
    VERSION,
    HTTP_UNAUTHORIZED, HTTP_BAD_REQUEST, HTTP_SERVER_ERROR, HTTP_FORBIDDEN
} from './const'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import pluginsApis from './api.plugins'
import monitorApis from './api.monitor'
import langApis from './api.lang'
import netApis from './api.net'
import logApis from './api.log'
import { getConnections } from './connections'
import { apiAssertTypes, debounceAsync, isLocalHost, makeNetMatcher, typedEntries, waitFor } from './misc'
import { accountCanLoginAdmin, accountsConfig } from './perm'
import Koa from 'koa'
import { cloudflareDetected, getProxyDetected } from './middlewares'
import { writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { customHtmlSections, customHtmlState, saveCustomHtml } from './customHtml'
import _ from 'lodash'
import { autoCheckUpdateResult, getUpdates, localUpdateAvailable, update, updateSupported } from './update'
import { resolve } from 'path'
import { getErrorSections } from './errorPages'
import { ip2country } from './geo'
import { roots } from './roots'
import { SendListReadable } from './SendList'
import { get_dynamic_dns_error } from './ddns'
import { addBlock, BlockingRule } from './block'
import { alerts, blacklistedInstalledPlugins, getProjectInfo } from './github'
import { acmeRenewError } from './acme'

export const adminApis = {

    ...vfsApis,
    ...accountsApis,
    ...pluginsApis,
    ...monitorApis,
    ...langApis,
    ...netApis,
    ...logApis,
    get_dynamic_dns_error,

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
    update: ({ tag }) => update(tag).catch(e => {
        throw e.cause?.statusCode ? new ApiError(e.cause?.statusCode) : e
    }),
    async check_update() {
        return { options: await getUpdates() }
    },
    async wait_project_info() { // used by admin/home/check-for-updates
        await getProjectInfo()
        return {}
    },

    async ip_country({ ips }) {
        const res = await Promise.allSettled(ips.map(ip2country))
        return {
            codes: res.map(x => x.status === 'rejected' || x.value === '-' ? '' : x.value)
        }
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
            baseUrl: await getBaseUrlOrDefault(),
            roots: roots.get(),
            updatePossible: !await updateSupported() ? false : (await localUpdateAvailable()) ? 'local' : true,
            autoCheckUpdateResult: autoCheckUpdateResult.get(), // in this form, we get the same type of the serialized json
            alerts: alerts.get(),
            proxyDetected: getProxyDetected(),
            cloudflareDetected,
            ram: process.memoryUsage.rss(),
            acmeRenewError,
            blacklistedInstalledPlugins,
            frpDetected: localhostAdmin.get() && !getProxyDetected()
                && getConnections().every(isLocalHost)
                && await frpDebounced(),
        }
    },

    async save_pem({ cert, private_key, name='self' }) {
        if (!cert || !private_key)
            return new ApiError(HTTP_BAD_REQUEST)
        const files = { cert: name + '.cer', private_key: name + '.key' }
        await writeFile(files.private_key, private_key)
        await writeFile(files.cert, cert)
        return files
    },

    async add_block({ merge, ip, expire, comment }: BlockingRule & { merge?: Partial<BlockingRule> }) {
        apiAssertTypes({
            string: { ip },
            string_undefined: { comment, expire },
            object_undefined: { merge },
        })
        const optionals = _.pickBy({ expire, comment }, v => v !== undefined) // passing undefined-s would override values in merge
        addBlock({ ip, ...optionals }, merge)
        return {}
    }

} satisfies ApiHandlers

for (const [k, was] of typedEntries(adminApis))
    (adminApis[k] as any) = ((params, ctx) => {
        if (!allowAdmin(ctx))
            return new ApiError(HTTP_FORBIDDEN)
        if (ctxAdminAccess(ctx))
            return was(params, ctx)
        const props = { possible: anyAccountCanLoginAdmin() }
        return ctx.headers.accept === 'text/event-stream'
            ? new SendListReadable({ doAtStart: x => x.error(HTTP_UNAUTHORIZED, true, props) })
            : new ApiError(HTTP_UNAUTHORIZED, props)
    }) satisfies ApiHandler

export const localhostAdmin = defineConfig('localhost_admin', true)
export const adminNet = defineConfig('admin_net', '', v => makeNetMatcher(v, true) )
export const favicon = defineConfig('favicon', '')
export const title = defineConfig('title', "File server")

export function ctxAdminAccess(ctx: Koa.Context) {
    return !ctx.ips.length // we consider localhost_admin only if no proxy is being used
        && localhostAdmin.get() && isLocalHost(ctx)
        || ctx.state.account && accountCanLoginAdmin(ctx.state.account)
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