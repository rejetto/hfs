// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { RequestOptions } from 'https'
import { IncomingMessage } from 'node:http'
import https from 'node:https'
import { HTTP_TEMPORARY_REDIRECT } from './const'

export function httpsString(url: string, options:RequestOptions={}): Promise<IncomingMessage & { ok: boolean, body: string }> {
    return httpsStream(url, options).then(res =>
        new Promise(resolve => {
            let buf = ''
            res.on('data', chunk => buf += chunk.toString())
            res.on('end', () => resolve(Object.assign(res, {
                ok: (res.statusCode || 400) < 400,
                body: buf
            })))
        })
    )
}

export function httpsStream(url: string, options:RequestOptions={}): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, res => {
            if (!res.statusCode || res.statusCode >= 400)
                return reject(new Error(String(res.statusCode), { cause: res }))
            if (res.statusCode === HTTP_TEMPORARY_REDIRECT && res.headers.location)
                return resolve(httpsStream(res.headers.location, options))
            resolve(res)
        }).on('error', e => {
            reject((req as any).res || e)
        }).end()
    })
}

