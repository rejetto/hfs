import { Resolver } from 'node:dns/promises'
import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { createHash } from 'node:crypto'
import { httpStream, readTextLimited } from './util-http'
import { setTimeout as delay } from 'node:timers/promises'

export type DnsCredentials = Record<string, string>
export interface AcmeDnsConfig {
    id: string
    provider: string
    config_version: number
    credentials: DnsCredentials
}
export interface DnsField { label?: string, secret?: boolean }
export interface DnsProviderInfo {
    id: string
    label: string
    config_version: number
    fields: Record<string, DnsField>
    available: boolean
    help_url?: string
}
export interface DnsRecord { name: string, zone: string, relative: string, value: string }
export type DnsCleanup = () => Promise<unknown>
export interface AcmeDnsProvider {
    help_url?: string
    label?: string
    config_version: number
    fields: Record<string, DnsField>
    propagation_timeout?: number // seconds
    present(record: DnsRecord, credentials: DnsCredentials): Promise<DnsCleanup>
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
interface DnsRequest {
    method: 'GET' | 'POST' | 'DELETE'
    path: string
    body?: Json
    expect?: [string, Json]
    select?: { field: string, equals: string }
    capture?: Record<string, string>
}
// recipes live in central.json; request paths append to the endpoint's path prefix
// templates containing only {variable.path} preserve JSON types; URL substitutions are escaped
// capture paths refer to the response after select; an empty path captures the whole response
// capture recordId during creation so a failing subsequent step can clean up the record
export interface DnsRecipe {
    help_url?: string
    driver: string
    config_version: number
    fields: Record<string, DnsField>
    providers: Record<string, { label?: string, endpoint: string, enabled?: boolean, help_url?: string }>
    auth?: 'ovh' | { basic: string }
    propagation_timeout?: number // seconds
    headers: Record<string, string>
    prepare?: DnsRequest[]
    create: DnsRequest[]
    remove: DnsRequest[]
}
const plugins = new Map<string, AcmeDnsProvider>()
export function registerAcmeDnsProvider(id: string, provider: AcmeDnsProvider) {
    if (!id || plugins.has(id)) throw Error("DNS provider ID already registered")
    if (!Number.isInteger(provider.config_version) || provider.config_version < 1 || typeof provider.present !== 'function')
        throw Error("Invalid DNS provider")
    plugins.set(id, provider)
    return () => { if (plugins.get(id) === provider) plugins.delete(id) }
}

export function getDnsProviders(catalog: unknown) {
    const providers = new Map<string, AcmeDnsProvider & { available: boolean }>()
    if (!Array.isArray(catalog)) throw Error("Invalid DNS provider catalog")
    for (const raw of catalog) {
        try {
            if (!raw || typeof raw !== 'object' || !raw.providers || typeof raw.providers !== 'object')
                throw Error("Invalid DNS provider catalog")
            const recipe = raw as DnsRecipe
            if (recipe.driver !== 'http-json1') continue
            validateRecipe(recipe)
            for (const [id, entry] of Object.entries(recipe.providers)) {
                try {
                    if (!entry || typeof entry.endpoint !== 'string' || new URL(entry.endpoint).protocol !== 'https:')
                        throw Error("Unsupported DNS API endpoint")
                    if (providers.has(id)) throw Error("Duplicate DNS provider")
                    providers.set(id, {
                        label: entry.label, config_version: recipe.config_version, fields: recipe.fields,
                        available: entry.enabled !== false, propagation_timeout: recipe.propagation_timeout, help_url: entry.help_url || recipe.help_url,
                        present: (record, credentials) => presentHttpDns(recipe, entry.endpoint, record, credentials),
                    })
                }
                catch (error) { console.warn("Skipping DNS provider", id, error instanceof Error ? error.message : String(error)) }
            }
        }
        // a broken recipe must not prevent independent providers from being used
        catch (error) { console.warn("Skipping DNS recipe", error instanceof Error ? error.message : String(error)) }
    }
    for (const [id, provider] of plugins) {
        if (providers.has(id)) throw Error("Duplicate DNS provider")
        providers.set(id, { ...provider, available: true })
    }
    return providers
}
export function dnsProviderInfo(catalog: unknown): DnsProviderInfo[] {
    return Array.from(getDnsProviders(catalog), ([id, p]) => ({
        id, label: p.label || id, config_version: p.config_version, fields: p.fields, available: p.available, help_url: p.help_url,
    })).sort((a, b) => a.label.localeCompare(b.label))
}
function validateRecipe(recipe: DnsRecipe) {
    if (!Number.isInteger(recipe.config_version) || recipe.config_version < 1 || !recipe.fields || typeof recipe.fields !== 'object' || Array.isArray(recipe.fields)
        || !recipe.headers || typeof recipe.headers !== 'object' || Array.isArray(recipe.headers)
        || Object.values(recipe.headers).some(value => typeof value !== 'string')
        || !Array.isArray(recipe.create) || !recipe.create.length || !Array.isArray(recipe.remove) || !recipe.remove.length
        || recipe.prepare !== undefined && !Array.isArray(recipe.prepare)) throw Error("Invalid DNS recipe")
    if (recipe.auth !== undefined && recipe.auth !== 'ovh'
        && (!recipe.auth || typeof recipe.auth !== 'object' || typeof recipe.auth.basic !== 'string')) throw Error("Invalid DNS authentication")
    if (recipe.propagation_timeout !== undefined && (!Number.isInteger(recipe.propagation_timeout) || recipe.propagation_timeout <= 0))
        throw Error("Invalid DNS propagation timeout")
    for (const field of Object.values(recipe.fields))
        if (!field || typeof field !== 'object' || field.label !== undefined && typeof field.label !== 'string'
            || field.secret !== undefined && typeof field.secret !== 'boolean') throw Error("Invalid DNS field")
    for (const step of [...recipe.prepare || [], ...recipe.create, ...recipe.remove])
        if (!step || !['GET', 'POST', 'DELETE'].includes(step.method) || typeof step.path !== 'string'
            || !step.path.startsWith('/') || step.path.startsWith('//')
            || step.expect !== undefined && (!Array.isArray(step.expect) || step.expect.length !== 2 || typeof step.expect[0] !== 'string')
            || step.select !== undefined && (!step.select || typeof step.select !== 'object'
                || typeof step.select.field !== 'string' || typeof step.select.equals !== 'string')
            || step.capture !== undefined && (!step.capture || typeof step.capture !== 'object' || Array.isArray(step.capture)
                || Object.values(step.capture).some(value => typeof value !== 'string'))) throw Error("Invalid DNS request")
}
function property(value: unknown, path: string): Json {
    for (const key of path ? path.split('.') : []) {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw Error("Missing DNS API response field")
        value = (value as Record<string, unknown>)[key]
    }
    if (value === undefined) throw Error("Missing DNS API response field")
    return value as Json
}
function expand(value: Json, variables: Record<string, Json>, url = false): Json {
    if (typeof value === 'string') {
        const whole = /^\{([\w.]+)\}$/.exec(value)
        if (whole && !url) return property(variables, whole[1]!)
        return value.replace(/\{([\w.]+)\}/g, (_, key) => {
            const v = property(variables, key)
            if (typeof v !== 'string' && typeof v !== 'number') throw Error("Invalid DNS request parameter")
            return url ? encodeURIComponent(v) : String(v)
        })
    }
    if (Array.isArray(value)) return value.map(v => expand(v, variables))
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, variables)]))
    return value
}

export async function presentHttpDns(recipe: DnsRecipe, endpoint: string, record: DnsRecord, credentials: DnsCredentials): Promise<DnsCleanup> {
    // retain the recipe and credentials used to create the record until cleanup finishes
    recipe = structuredClone(recipe)
    credentials = { ...credentials }
    const vars: Record<string, Json> = Object.assign(Object.create(null), { credentials, ...record })
    let ovhOffset = 0
    async function run(steps: DnsRequest[], authenticate = true) {
        for (const step of steps) {
            const url = new URL(endpoint.replace(/\/$/, '') + expand(step.path, vars, true))
            if (url.origin !== new URL(endpoint).origin || url.username || url.password) throw Error("Invalid DNS API URL")
            const body = step.body === undefined ? undefined : JSON.stringify(expand(step.body, vars))
            const headers = { 'content-type': 'application/json', ...expand(recipe.headers, vars) as Record<string, string> }
            if (authenticate && recipe.auth) {
                if (recipe.auth === 'ovh') {
                    // sign the exact bytes sent, using server time to tolerate an incorrect local clock
                    const timestamp = Math.floor((Date.now() + ovhOffset) / 1000)
                    Object.assign(headers, {
                        'X-Ovh-Application': credentials.applicationKey,
                        'X-Ovh-Consumer': credentials.consumerKey,
                        'X-Ovh-Timestamp': String(timestamp),
                        'X-Ovh-Signature': '$1$' + createHash('sha1').update([
                            credentials.applicationSecret, credentials.consumerKey, step.method, url.href, body || '', timestamp,
                        ].join('+')).digest('hex'),
                    })
                }
                else Object.assign(headers, { Authorization: 'Basic ' + Buffer.from(String(expand(recipe.auth.basic, vars))).toString('base64') })
            }
            // avoid exposing raw response bodies; OVH diagnostic fields are redacted below
            const response = await httpStream(url.href, {
                method: step.method, headers, body,
                timeout: 20_000, noRedirect: true, httpThrow: false,
            }).catch((error: NodeJS.ErrnoException) => {
                throw Error(`DNS API connection failed (${error.code || 'network error'})`)
            })
            let data: Json
            try {
                const body = await readTextLimited(response, 1024 * 1024).catch((error: NodeJS.ErrnoException) => {
                    throw Error(`DNS API response interrupted (${error.code || 'network error'})`)
                })
                if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                    let detail = ''
                    if (recipe.auth === 'ovh' && !('error' in body)) {
                        try {
                            const { errorCode, message } = JSON.parse(body.text)
                            detail = [errorCode, message].filter(value => typeof value === 'string').join(': ')
                            for (const secret of Object.values(credentials))
                                if (secret) detail = detail.replaceAll(secret, '[redacted]')
                            detail = detail.slice(0, 500)
                        }
                        catch {} // non-JSON errors still report the HTTP status
                    }
                    throw Error(`DNS API returned HTTP ${response.statusCode || 'unknown'} (${step.method} ${url.hostname} ${step.path})${detail ? ': ' + detail : ''}`)
                }
                if ('error' in body) throw Error("DNS API response exceeds 1 MB")
                try { data = body.text ? JSON.parse(body.text) : null }
                catch { throw Error("DNS API returned invalid JSON") }
            }
            finally { response.destroy() }
            if (step.select) {
                if (!Array.isArray(data)) throw Error("Invalid DNS list response")
                const { field, equals } = step.select
                const selected = data.filter(item => property(item, field) === expand(equals, vars))
                if (selected.length !== 1) throw Error("DNS zone missing or ambiguous")
                data = selected[0]!
            }
            if (step.expect && property(data, step.expect[0]) !== step.expect[1]) throw Error("DNS API rejected the request")
            for (const [key, path] of Object.entries(step.capture || {})) vars[key] = property(data, path)
        }
    }
    if (recipe.auth === 'ovh') {
        await run([{ method: 'GET', path: '/auth/time', capture: { serverTime: '' } }], false)
        if (typeof vars.serverTime !== 'number' || !Number.isFinite(vars.serverTime)) throw Error("Invalid DNS API server time")
        ovhOffset = vars.serverTime * 1000 - Date.now()
    }
    await run(recipe.prepare || [])
    try { await run(recipe.create) }
    catch (error) {
        if ('recordId' in vars) {
            try { await run(recipe.remove) }
            catch { throw Error("DNS creation and cleanup failed; check the challenge TXT record") }
        }
        throw error
    }
    return () => run(recipe.remove)
}

export function certificateNames(names: string[]) {
    const normalized = names.flatMap(name => {
        name = name.trim().replace(/\.$/, '').toLowerCase()
        const wildcard = name.startsWith('*.')
        const host = wildcard ? name.slice(2) : name
        const ascii = isIP(host) ? host : domainToASCII(host)
        if (!ascii || host.includes('*') || !isIP(host) && (!ascii.includes('.') || ascii.length > 253
            || ascii.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))
            || wildcard && isIP(host)) throw Error("Invalid certificate domain")
        return wildcard ? ['*.' + ascii, ascii] : [ascii]
    })
    if (!normalized.length) throw Error("Enter a domain for the certificate")
    return [...new Set(normalized)]
}

export async function dnsChallengeRecord(domain: string, value: string, resolver: Resolver): Promise<DnsRecord> {
    let name = '_acme-challenge.' + domain.replace(/^\*\./, '')
    const visited = new Set<string>()
    // follow only the validation name: the website's CNAME is unrelated to DNS-01
    for (;;) {
        if (visited.has(name) || visited.size >= 16) throw Error("DNS challenge CNAME loop")
        visited.add(name)
        const aliases = await resolver.resolveCname(name).catch(ignoreMissingDns)
        if (!aliases?.length) break
        name = aliases[0]!.toLowerCase().replace(/\.$/, '')
    }
    let zone = name
    for (;;) {
        const soa = await resolver.resolveSoa(zone).catch(ignoreMissingDns)
        if (soa) break
        const dot = zone.indexOf('.')
        if (dot < 0) throw Error("Cannot find the authoritative DNS zone")
        zone = zone.slice(dot + 1)
    }
    return { name, zone, relative: name === zone ? '' : name.slice(0, -zone.length - 1), value }
}
function ignoreMissingDns(error: NodeJS.ErrnoException) {
    if (error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error
}
export async function waitForDnsRecord(record: DnsRecord, resolver: Resolver, timeout = 5 * 60_000) {
    const until = Date.now() + timeout
    do {
        const values = await resolver.resolveTxt(record.name).catch(ignoreMissingDns)
        if (values?.some(parts => parts.join('') === record.value)) return
        await delay(Math.min(2000, Math.max(0, until - Date.now())))
    } while (Date.now() < until)
    throw Error("Timed out waiting for the DNS TXT record to propagate")
}
