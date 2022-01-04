import Koa from 'koa'
import { Writable } from 'stream'
import { subscribeConfig } from './config'
import { createWriteStream } from 'fs'
import * as util from 'util'

class Logger {
    stream?: Writable

    setPath(path: string) {
        this.stream?.end()
        if (!path)
            return this.stream = undefined
        this.stream = createWriteStream(path, { flags: 'a' })
    }
}

const accessLogger = new Logger()

subscribeConfig({ k: 'log', defaultValue: 'access.log' }, path => {
    console.debug('log file: ' + (path || 'disabled'))
    accessLogger.setPath(path)
})

export function log(): Koa.Middleware {
    return async (ctx, next) => {  // wrapping in a function will make it use current 'mw' value
        await next()
        const st = accessLogger.stream
        if (!st) return
        const format = '%s - - [%s] "%s %s HTTP/%s" %d %s\n';
        const a = new Date().toString().split(' ')
        const date = a[2]+'/'+a[1]+'/'+a[3]+':'+a[4]+' '+a[5].slice(3)
        st.write(util.format( format,
            ctx.ip,
            date,
            ctx.method,
            ctx.path,
            ctx.req.httpVersion,
            ctx.status,
            ctx.length ? ctx.length.toString() : '-',
        ))
    }
}
