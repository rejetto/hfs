// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import https, { RequestOptions } from 'node:https'
import http, { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import _ from 'lodash'

// in case the response is not 2xx, it will throw and the error object is the Response object
export async function httpString(url: string, options?: XRequestOptions): Promise<string> {
    const res = await httpStream(url, options)
    if (!_.inRange(res.statusCode!, 200, 299))
        throw res
    return await stream2string(res)
}

export async function stream2string(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = ''
        stream.on('data', chunk =>
            data += chunk)
        stream.on('error', reject)
        stream.on('end', () => {
            try {
                resolve(data)
            }
            catch(e) {
                reject(e)
            }
        })
    })
}

export interface XRequestOptions extends RequestOptions {
    body?: string | Buffer | Readable
    // basic cookie store
    jar?: Record<string, string>
    noRedirect?: boolean
}

export function httpStream(url: string, { body, jar, noRedirect, ...options }: XRequestOptions ={}): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        if (body)
            options.method ||= 'POST'
        if (jar)
            (options.headers ||= {}).cookie = _.map(jar, (v,k) => `${k}=${v}; `).join('')
                + (options.headers.cookie || '') // preserve parameter
        const proto = url.startsWith('https:') ? https : http
        const req = proto.request(url, options, res => {
            console.debug("http responded", res.statusCode, "to", url)
            if (jar) for (const entry of res.headers['set-cookie'] || []) {
                const [, k, v] = /(.+?)=([^;]+)/.exec(entry) || []
                if (!k) continue
                if (v) jar[k] = v
                else delete jar[k]
            }
            if (!res.statusCode || res.statusCode >= 400)
                return reject(new Error(String(res.statusCode), { cause: res }))
            if (res.headers.location && !noRedirect)
                return resolve(httpStream(res.headers.location, options))
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

