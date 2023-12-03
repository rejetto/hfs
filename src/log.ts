// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { once, Writable } from 'stream'
import { defineConfig } from './config'
import { createWriteStream, renameSync } from 'fs'
import * as util from 'util'
import { stat } from 'fs/promises'
import _ from 'lodash'
import { createFileWithPath, prepareFolder } from './util-files'
import { getCurrentUsername } from './auth'
import { DAY, makeNetMatcher, tryJson } from './misc'
import events from './events'

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
        catch {
            if (await prepareFolder(path) === false)
                console.log("cannot create folder for", path)
        }
        this.reopen()
    }

    reopen() {
        return this.stream = createFileWithPath(this.path, { flags: 'a' })
            ?.on('error', () => this.stream = undefined)
    }
}

// we'll have names same as config keys. These are used also by the get_log api.
const accessLogger = new Logger('log')
const accessErrorLog = new Logger('error_log')
export const loggers = [accessLogger, accessErrorLog]

defineConfig(accessLogger.name, 'logs/access.log').sub(path => {
    console.debug('access log file: ' + (path || 'disabled'))
    accessLogger.setPath(path)
})

const errorLogFile = defineConfig(accessErrorLog.name, 'logs/access-error.log')
errorLogFile.sub(path => {
    console.debug('access error log: ' + (path || 'disabled'))
    accessErrorLog.setPath(path)
})

const logRotation = defineConfig('log_rotation', 'weekly')
const dontLogNet = defineConfig('dont_log_net', '127.0.0.1|::1', v => makeNetMatcher(v))

const debounce = _.debounce(cb => cb(), 1000)

export const logMw: Koa.Middleware = async (ctx, next) => {
    const now = new Date()
    await next()
    console.debug(ctx.status, ctx.method, ctx.originalUrl)
    // don't await, as we don't want to hold the middlewares chain
    ctx.state.completed = Promise.race([ once(ctx.res, 'finish'), once(ctx.res, 'close') ])
    ctx.state.completed.then(() => {
        if (ctx.state.dont_log) return
        if (dontLogNet.compiled()(ctx.ip)) return
        const isError = ctx.status >= 400
        const logger = isError && accessErrorLog || accessLogger
        const rotate = logRotation.get()?.[0]
        let { stream, last, path } = logger
        if (!stream) return
        logger.last = now
        if (rotate && last) { // rotation enabled and a file exists?
            const passed = Number(now) - Number(last)
                - 3600_000 // be pessimistic and count a possible DST change
            if (rotate === 'm' && (passed >= 31*DAY || now.getMonth() !== last.getMonth())
                || rotate === 'd' && (passed >= DAY || now.getDate() !== last.getDate()) // checking passed will solve the case when the day of the month is the same but a month has passed
                || rotate === 'w' && (passed >= 7*DAY || now.getDay() < last.getDay())) {
                stream.end()
                const postfix = last.getFullYear() + '-' + doubleDigit(last.getMonth() + 1) + '-' + doubleDigit(last.getDate())
                try { // other logging requests shouldn't happen while we are renaming. Since this is very infrequent we can tolerate solving this by making it sync.
                    renameSync(path, path + '-' + postfix)
                }
                catch(e: any) {  // ok, rename failed, but this doesn't mean we ain't gonna log
                    console.error(String(e || e.message))
                }
                stream = logger.reopen() // keep variable updated
                if (!stream) return
            }
        }
        const format = '%s - %s [%s] "%s %s HTTP/%s" %d %s %s\n' // Apache's Common Log Format
        const a = now.toString().split(' ')
        const date = a[2]+'/'+a[1]+'/'+a[3]+':'+a[4]+' '+a[5]?.slice(3)
        const user = getCurrentUsername(ctx)
        const length = ctx.state.length ?? ctx.length
        const uri = ctx.originalUrl
        const extra = ctx.state.includesLastByte && ctx.vfsNode && ctx.res.finished && { dl: 1 }
            || ctx.state.uploadPath && { ul: ctx.state.uploadPath, size: ctx.state.uploadSize }
            || ctx.state.logExtra
        events.emit(logger.name, Object.assign(_.pick(ctx, ['ip', 'method','status']), { length, user, ts: now, uri, extra }))
        debounce(() => // once in a while we check if the file is still good (not deleted, etc), or we'll reopen it
            stat(logger.path).catch(() => logger.reopen())) // async = smoother but we may lose some entries
        stream!.write(util.format( format,
            ctx.ip,
            user || '-',
            date,
            ctx.method,
            uri,
            ctx.req.httpVersion,
            ctx.status,
            length?.toString() ?? '-',
            extra ? JSON.stringify(JSON.stringify(extra)) : '',
        ))
    })
}

function doubleDigit(n: number) {
    return n > 9 ? n : '0'+n
}

// dump console.error to file
const debugLogFile = createWriteStream('debug.log', { flags: 'a' })
debugLogFile.on('open', () => {
    const was = console.error
    console.error = function(...args: any[]) {
        was.apply(this, args)
        args = args.map(x => typeof x === 'string' ? x : (tryJson(x) ?? String(x)))
        debugLogFile.write(new Date().toLocaleString() + ': ' + args.join(' ') + '\n')
    }
}).on('error', () => console.log("cannot create debug.log"))
