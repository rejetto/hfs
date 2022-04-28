// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { Writable } from 'stream'
import { defineConfig } from './config'
import { createWriteStream, existsSync, renameSync, WriteStream } from 'fs'
import * as util from 'util'
import { stat } from 'fs/promises'
import { DAY } from './const'
import events from './events'
import _ from 'lodash'

class Logger {
    stream?: Writable
    last?: Date
    path: string = ''

    constructor(readonly name: string){
    }

    async setPath(path: string) {
        this.path = path
        this.stream?.end()
        this.last = undefined
        if (!path)
            return this.stream = undefined
        try {
            const stats = await stat(path)
            this.last = stats.mtime || stats.ctime
        }
        catch {}
        this.reopen()
    }

    reopen() {
        return this.stream = createWriteStream(this.path, { flags: 'a' })
    }
}

// we'll have names same as config keys. These are used also by the get_log api.
const accessLogger = new Logger('log')
const errorLogger = new Logger('error_log')
export const loggers = [accessLogger, errorLogger]

defineConfig('log', 'access.log').sub(path => {
    console.debug('log file: ' + (path || 'disabled'))
    accessLogger.setPath(path)
})

const errorLogFile = defineConfig('error_log', 'error.log')
errorLogFile.sub(path => {
    console.debug('error log: ' + (path || 'disabled'))
    errorLogger.setPath(path)
})

const logRotation = defineConfig('log_rotation', 'weekly')

export function log(): Koa.Middleware {
    return async (ctx, next) => {  // wrapping in a function will make it use current 'mw' value
        await next()
        const isError = ctx.status >= 400
        const logger = isError && errorLogger || accessLogger
        const rotate = logRotation.get()?.[0]
        let { stream, last, path } = logger
        if (!stream) return
        const now = new Date()
        const a = now.toString().split(' ')
        logger.last = now
        if (rotate && last) { // rotation enabled and a file exists?
            const passed = Number(now) - Number(last)
                - 3600_000 // be pessimistic and count a possible DST change
            if (rotate === 'm' && (passed >= 31*DAY || now.getMonth() !== last.getMonth())
            || rotate === 'd' && (passed >= DAY || now.getDate() !== last.getDate())
            || rotate === 'w' && (passed >= 7*DAY || now.getDay() < last.getDay())) {
                stream.end()
                const postfix = last.getFullYear() + '-' + doubleDigit(last.getMonth() + 1) + '-' + doubleDigit(last.getDate())
                try { // other logging requests shouldn't happen while we are renaming. Since this is very infrequent we can tolerate solving this by making it sync.
                    renameSync(path, path + '-' + postfix)
                }
                catch(e) {  // ok, rename failed, but this doesn't mean we ain't gonna log
                    console.error(e)
                }
                stream = logger.reopen() // keep variable updated
            }
        }
        const format = '%s - - [%s] "%s %s HTTP/%s" %d %s\n';
        const date = a[2]+'/'+a[1]+'/'+a[3]+':'+a[4]+' '+a[5].slice(3)
        events.emit(logger.name, Object.assign(_.pick(ctx, ['ip', 'method','status','length']), { ts: now, uri: ctx.path }))
        stream.write(util.format( format,
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

function doubleDigit(n: number) {
    return n > 9 ? n : '0'+n
}

{ // dump console.error to file
    const was = console.error
    let log: WriteStream
    console.error = function(...args: any[]) {
        was.apply(this, args)
        if (!log || !existsSync(log.path))
            log = createWriteStream('debug.log', { flags: 'a' })
        const params = args.map(x =>
            typeof x === 'string' ? x : JSON.stringify(x)).join(' ')
        log.write(new Date().toJSON() + ': ' + params + '\n')
    }
}
