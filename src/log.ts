import Koa from 'koa'
import { Writable } from 'stream'
import { subscribe } from './config'
import { createWriteStream } from 'fs'
// @ts-ignore
import accesslog from 'koa-accesslog'

class Logger {
    mw?: Koa.Middleware
    stream?: Writable
    setPath(path: string) {
        this.stream?.end()
        if (!path)
            return this.mw = this.stream = undefined
        this.stream = createWriteStream(path, { flags: 'a' })
        this.mw = accesslog(this.stream)
    }
}
const accessLogger = new Logger()

subscribe('log', path => {
    console.debug('log file: ' + (path || 'disabled'))
    accessLogger.setPath(path)
}, 'access.log')

export function log(): Koa.Middleware {
    return (ctx, next) => // wrapping in a function will make it use current value
        accessLogger.mw?.(ctx, next)
}
