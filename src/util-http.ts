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
        https.request(url, options, res => {
            if (!res.statusCode || res.statusCode >= 400)
                throw res
            if (res.statusCode === HTTP_TEMPORARY_REDIRECT && res.headers.location)
                return resolve(httpsStream(res.headers.location, options))
            resolve(res)
        }).on('error', reject).end()
    })
}

