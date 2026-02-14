// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { urlToHttpOptions } from 'node:url'
import https from 'node:https'
import http, { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import _ from 'lodash'
import { text as stream2string, buffer } from 'node:stream/consumers'
import * as tls from 'node:tls'
import { enforceStarting } from './cross'
export { stream2string }

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
    // very basic cookie store
    jar?: { [host: string]: { [cookieName: string]: string } }
    noRedirect?: boolean
    // throw for http-level errors. Default is true.
    httpThrow?: boolean
}

export declare namespace httpStream { let defaultProxy: string | undefined }
export function httpStream(url: string, { body, proxy, jar, noRedirect, httpThrow=true, ...options }: XRequestOptions ={}, redirected: string[]=[]) {
    const controller = new AbortController()
    options.signal ??= controller.signal
    return Object.assign(new Promise<IncomingMessage>(async (resolve, reject) => {
        proxy ??= httpStream.defaultProxy
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
        const { auth, ...parsed } = parseHttpUrl(url)
        const hostJar = jar && (jar[parsed.hostname || ''] ||= {})
        if (hostJar) {
            options.headers.cookie = _.map(hostJar, (v,k) => `${k}=${v}; `).join('')
                + (options.headers.cookie || '') // preserve parameter
        }
        const proxyParsed = proxy ? parseHttpUrl(proxy) : null
        Object.assign(options, _.pick(proxyParsed || parsed, ['hostname', 'port', 'path', 'protocol']))
        if (auth) {
            options.auth = auth
            if (proxy)
                url = parsed.protocol + '//' + parsed.host + parsed.path // rewrite without authentication part
        }
        if (proxy) {
            options.path = url // full url as path
            options.headers.host ??= parsed.host || undefined // keep original host header
        }
        // this needs the prefix "proxy-"
        const proxyAuth = proxyParsed?.auth ? { 'proxy-authorization': `Basic ${Buffer.from(proxyParsed.auth, 'utf8').toString('base64')}` } : undefined

        // https through proxy is better with CONNECT
        if (!proxy || parsed.protocol === 'http:' || !await connect())
            Object.assign(options.headers, proxyAuth)

        const proto = options.protocol === 'https:' ? https : http
        const req = proto.request(options, res => {
            console.debug("http responded", res.statusCode, "to", url)
            if (hostJar) for (const entry of res.headers['set-cookie'] || []) {
                const [, k, v] = /(.+?)=([^;]+)/.exec(entry) || []
                if (!k) continue
                if (v) hostJar[k] = v
                else delete hostJar[k]
            }
            if (!res.statusCode || httpThrow && res.statusCode >= 400)
                return reject(new Error(String(res.statusCode), { cause: res }))
            let r = res.headers.location
            if (r && !noRedirect) {
                const dest = new URL(r, url) // rewrite in case r is just a path, and thus relative to the current url
                r = dest.toString()
                const src = new URL(url)
                const sameOrigin = src.protocol === dest.protocol && src.host === dest.host
                return redirected.includes(r) ? reject(new Error('endless http redirection'))
                    : redirected.length > 20 ? reject(new Error('excessive http redirection'))
                    : resolve(httpStream(r, {
                            httpThrow, jar, proxy,
                            ..._.pick(options, ['agent', 'rejectUnauthorized', 'timeout']),
                            // forward some headers and exclude authorization if it's cross-origin
                            headers: options.headers && _.omit(options.headers, ['content-length', 'host', 'connection', 'transfer-encoding', sameOrigin ? '' : 'authorization']),
                        }, [...redirected, r]))
            }
            resolve(res)
        }).on('error', (e: any) => {
            if (proxy && e?.code === 'ECONNREFUSED')
                console.debug("cannot connect to proxy ", proxy)
            e.cause ??= req // enrich the error
            reject(e)
        })
        if (body && body instanceof Readable)
            body.pipe(req).on('end', () => req.end())
        else
            req.end(body)

        function connect() {
            return proxyParsed && new Promise<boolean>(resolve => {
                const path = `${parsed.hostname}:${parsed.port || 443}`
                ;(proxyParsed.protocol === 'https:' ? https : http).request({
                    ...proxyParsed,
                    auth: undefined, // void proxyParsed.auth
                    method: 'CONNECT',
                    path,
                    headers: { Host: path, ...proxyAuth }
                }).on('connect', (res, socket) => {
                    if (res.statusCode !== 200)
                        return resolve(false)
                    // we are creating a TLS for every request, very inefficient. Consider optimizing in the future, especially for reading plugins from github, which makes tens of requests.
                    options.createConnection = () => tls.connect({ socket, servername: parsed.hostname || undefined })
                    resolve(true)
                }).on('response', res => {
                    console.debug("proxy CONNECT response", res.statusCode, res.statusMessage)
                    resolve(false)
                }).on('error', reject)
                    .end()
            })
        }

    }), {
        abort() { controller.abort() }
    })
}

// works the same way as the now deprecated url.parse()
export function parseHttpUrl(url: string) {
    const parsed = new URL(url)
    const options = urlToHttpOptions(parsed)
    const withoutHash = url.split('#', 1)[0]!
    const authority = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(withoutHash)?.[0]
    return {
        ...options,
        host: parsed.host,
        path: !authority ? '/' : enforceStarting('/', withoutHash.slice(authority.length)), // unresolved paths are useful in our tests
    }
}
