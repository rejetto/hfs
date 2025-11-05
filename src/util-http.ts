// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { parse } from 'node:url'
import https from 'node:https'
import http, { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import _ from 'lodash'
import { text as stream2string, buffer } from 'node:stream/consumers'
import * as tls from 'node:tls'
import { Dict, pendingPromise } from './cross'
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
    jar?: Record<string, string>
    noRedirect?: boolean
    // throw for http-level errors. Default is true.
    httpThrow?: boolean
}

export declare namespace httpStream { let defaultProxy: string | undefined }
export function httpStream(url: string, { body, proxy, jar, noRedirect, httpThrow=true, ...options }: XRequestOptions ={}) {
    const controller = new AbortController()
    options.signal ??= controller.signal
    let ret: Promise<unknown>
    return Object.assign(ret = new Promise<IncomingMessage>(async (resolve, reject) => {
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
        if (jar)
            options.headers.cookie = _.map(jar, (v,k) => `${k}=${v}; `).join('')
                + (options.headers.cookie || '') // preserve parameter
        const { auth, ...parsed } = parse(url)
        const proxyParsed = proxy ? parse(proxy) : null
        Object.assign(options, _.pick(proxyParsed || parsed, ['hostname', 'port', 'path', 'protocol']))
        if (auth) {
            options.auth = auth
            if (proxy)
                url = parsed.protocol + '//' + parsed.host + parsed.path // rewrite without authentication part
        }
        if (proxy) {
            options.path = url // full url as path
            options.headers.host ??= parse(url).host || undefined // keep original host header
            options.headers.Connection = 'keep-alive' // try to reuse connections
        }
        // this needs the prefix "proxy-"
        const proxyAuth = proxyParsed?.auth ? { 'proxy-authorization': `Basic ${Buffer.from(proxyParsed.auth, 'utf8').toString('base64')}` } : undefined

        // https through proxy is better with CONNECT
        if (!proxy || parsed.protocol === 'http:' || !await connect())
            Object.assign(options.headers, proxyAuth)

        const proto = options.protocol === 'https:' ? https : http
        const req = proto.request(options, res => {
            console.debug("http responded", res.statusCode, "to", url)
            if (jar) for (const entry of res.headers['set-cookie'] || []) {
                const [, k, v] = /(.+?)=([^;]+)/.exec(entry) || []
                if (!k) continue
                if (v) jar[k] = v
                else delete jar[k]
            }
            if (!res.statusCode || httpThrow && res.statusCode >= 400)
                return reject(new Error(String(res.statusCode), { cause: res }))
            let r = res.headers.location
            if (r && !noRedirect) {
                r = new URL(r, url).toString() // rewrite in case r is just a path, and thus relative to current url
                const stack = ((options as any)._stack ||= [])
                if (stack.length > 20 || stack.includes(r))
                    return reject(Error('endless http redirection'))
                stack.push(r)
                delete options.method // redirections are always GET
                delete options.headers?.['content-length']
                delete options.headers?.host
                delete options.auth
                delete options.path
                delete options.agent
                return resolve(httpStream(r, options))
            }
            resolve(res)
        }).on('error', (e: any) => {
            if (proxy && e?.code === 'ECONNREFUSED')
                console.debug("cannot connect to proxy", proxy)
            reject((req as any).res || e)
        })
        if (options.timeout)
            req.setTimeout(options.timeout, () => req.destroy(Error('ETIMEDOUT')))
        options.signal?.addEventListener('abort', () => req.destroy(Error('AbortError')), { once: true })
        if (body && body instanceof Readable)
            body.pipe(req).on('end', () => req.end())
        else
            req.end(body)

        async function connect() {
            if (!proxyParsed) return
            const path = `${parsed.hostname}:${parsed.port || 443}`
            const k = proxy + path
            const pool = (proxySocketPools[k] ||= [])
            const newProm = pendingPromise<SocketWithPoolRef>()
            if (pool.length >= 4)
                return seqRace = seqRace.then(async () => { // one race at a time, to ensure the next race is done on an updated pool
                    try { // race tracking the index
                        const [i, socket] = await Promise.race(pool.map((prom, i) => prom.then(socket => [i, socket] as const)))
                        pool[i] = socket.poolRef = newProm // replacing ensures the pool reflects the current usage of open sockets
                        options.createConnection = () => socket
                        ret.catch(() => {}).then(() => newProm.resolve(socket))
                        return true
                    }
                    catch (e) {
                        newProm.catch(() => {}) // without this we get UnhandledPromiseRejection
                        newProm.reject(e)
                        return false
                    }
                })
            pool.push(newProm)
            return new Promise<boolean>(resolve => {
                ;(proxyParsed.protocol === 'https:' ? https : http).request({
                    ...proxyParsed,
                    auth: undefined, // void proxyParsed.auth
                    method: 'CONNECT',
                    path,
                    headers: { Host: path, ...proxyAuth }
                }).on('connect', (res, socket) => {
                    if (res.statusCode !== 200)
                        return failed(res)
                    const tlsSocket = Object.assign(tls.connect({ socket, servername: parsed.hostname || undefined }),
                        { poolRef: newProm })
                    tlsSocket.on('close', disconnected)
                    tlsSocket.on('error', disconnected)
                    options.createConnection = () => tlsSocket
                    ret.catch(() => {}).then(() => newProm.resolve(tlsSocket)) // when we are done with this request, resolve and pass the socket on
                    resolve(true)

                    function disconnected() {
                        _.pull(pool, tlsSocket.poolRef) // the ref may have changed in time
                    }
                }).on('response', failed).on('error', failed).end()

                function failed(e: any) {
                    _.pull(pool, newProm)
                    newProm.catch(() => {}) // without this we get UnhandledPromiseRejection
                    newProm.reject(e)
                    resolve(false)
                }
            })
        }

    }), {
        abort() { controller.abort() }
    })
}

interface SocketWithPoolRef extends tls.TLSSocket {
    poolRef: Promise<SocketWithPoolRef>
}
const proxySocketPools: Dict<Promise<SocketWithPoolRef>[]> = {}
let seqRace = Promise.resolve(false)
