// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { Transform } from 'stream'
import { HTTP_OK } from './const'

export default function createSSE(ctx: Koa.Context) {
    const { socket } = ctx.req
    socket.setTimeout(0)
    socket.setNoDelay(true)
    socket.setKeepAlive(true)
    ctx.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // avoid buffering when reverse-proxied through nginx
    })
    ctx.status = HTTP_OK
    return ctx.body = new Transform({
        objectMode: true,
        transform(chunk, encoding, cb) {
            this.push(`data: ${JSON.stringify(chunk)}\n\n`)
            cb()
        },
        flush(cb) {
            this.push('data:\n\n')
            cb()
        }
    })
}
