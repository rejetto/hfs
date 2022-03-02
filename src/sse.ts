// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { PassThrough } from 'stream'

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
    ctx.status = 200
    const stream = ctx.body = new PassThrough()
    const ret = {
        stream,
        stopped: false,
        send(data:any){
            stream.write(`data: ${JSON.stringify(data)}\n\n`)
        },
        close() {
            stream.end('data:\n\n')
        }
    }
    stream.on('close', ()=>
        ret.stopped = true)
    return ret
}
