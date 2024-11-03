// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { once, Writable } from 'stream'
import { defineConfig } from './config'
import { createWriteStream, renameSync, statSync } from 'fs'
import * as util from 'util'
import { stat } from 'fs/promises'
import _ from 'lodash'
import { createFileWithPath, prepareFolder } from './util-files'
import { getCurrentUsername } from './auth'
import { DAY, makeNetMatcher, tryJson, Dict, Falsy, CFG, strinsert, repeat, HTTP_NOT_FOUND } from './misc'
import { extname } from 'path'
import events from './events'
import { getConnection } from './connections'
import { app } from './index'
import { logGui } from './serveGuiFiles'

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
const accessLogger = new Logger(CFG.log)
const accessErrorLog = new Logger(CFG.error_log)
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

const logRotation = defineConfig(CFG.log_rotation, 'weekly')
const dontLogNet = defineConfig(CFG.dont_log_net, '127.0.0.1|::1', v => makeNetMatcher(v))
const logUA = defineConfig(CFG.log_ua, false)
const logSpam = defineConfig(CFG.log_spam, false)

const debounce = _.debounce(cb => cb(), 1000) // with this technique, i'll be able to debounce some code respecting the references in its closure

export const logMw: Koa.Middleware = async (ctx, next) => {
    const now = new Date()
    // do it now so it's available for returning plugins
    ctx.state.completed = Promise.race([ once(ctx.res, 'finish'), once(ctx.res, 'close') ])
    await next()
    console.debug(ctx.status, ctx.method, ctx.originalUrl)
    if (!logSpam.get()
        && (ctx.querystring.includes('{.exec|')
            || ctx.status === HTTP_NOT_FOUND && /wlwmanifest.xml$|robots.txt$|\.(php)$|cgi/.test(ctx.path))) {
        events.emit('spam', ctx)
        return
    }
    const conn = getConnection(ctx) // collect reference before close
    // don't await, as we don't want to hold the middlewares chain
    ctx.state.completed.then(() => {
        if (ctx.state.dontLog || ctx.state.considerAsGui && !logGui.get()) return
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
                const suffix = '-' + last.getFullYear() + '-' + doubleDigit(last.getMonth() + 1) + '-' + doubleDigit(last.getDate())
                const newPath = strinsert(path, path.length - extname(path).length, suffix)
                try { // other logging requests shouldn't happen while we are renaming. Since this is very infrequent we can tolerate solving this by making it sync.
                    renameSync(path, newPath)
                }
                catch(e: any) {  // ok, rename failed, but this doesn't mean we ain't gonna log
                    console.error(e.message || String(e))
                }
                stream = logger.reopen() // keep variable updated
                if (!stream) return
            }
        }
        const format = '%s - %s [%s] "%s %s HTTP/%s" %d %s %s\n' // Apache's Common Log Format
        const a = now.toString().split(' ') // like nginx, our default log contains the time of log writing
        const date = a[2]+'/'+a[1]+'/'+a[3]+':'+a[4]+' '+a[5]?.slice(3)
        const user = getCurrentUsername(ctx)
        const length = ctx.state.length ?? ctx.length
        const uri = ctx.originalUrl
        ctx.logExtra(ctx.state.includesLastByte && ctx.vfsNode && ctx.res.finished && { dl: 1 }
            || ctx.state.uploadPath && { size: ctx.state.opTotal, ul: ctx.state.uploads })
        if (conn?.country)
            ctx.logExtra({ country: conn.country })
        if (logUA.get())
            ctx.logExtra({ ua: ctx.get('user-agent') || undefined })
        const extra = ctx.state.logExtra
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
            _.isEmpty(extra) ? '' : JSON.stringify(JSON.stringify(extra)), // jsonize twice, as we need a field enclosed by double-quotes
        ))
    })
}

declare module "koa" {
    interface BaseContext {
        logExtra(o: Falsy | Dict<any>, params?: Dict<any>): void
    }
    interface DefaultState {
        dontLog?: boolean // don't log this request
        logExtra?: object
        completed?: Promise<unknown>
        spam?: boolean // this request was marked as spam
        considerAsGui?: boolean
    }
}

events.once('app', () => { // wait for app to be set
    app.context.logExtra = function(anything, params) { // no => as we need 'this'
        _.merge((this as any).state, { logExtra: { ...anything, params } }) // params will be considered as parameters of the API
    }
})

function doubleDigit(n: number) {
    return n > 9 ? n : '0'+n
}

// dump console.error to file
let debugLogFile = createWriteStream('debug.log', { flags: 'a' })
debugLogFile.once('open', () => {
    const was = console.error
    console.error = function(...args: any[]) {
        was.apply(this, args)
        args = args.map(x => typeof x === 'string' ? x : (tryJson(x) ?? String(x)))
        debugLogFile.write(new Date().toLocaleString() + ': ' + args.join(' ') + '\n')
    }
    // limit log size
    const LIMIT = 1_000_000
    const { path } = debugLogFile
    repeat(DAY, () => { // do it sync, to avoid overlapping
        if (statSync(path).size < LIMIT) return // no need
        renameSync(path, 'old-' + path)
        debugLogFile = createWriteStream(path, { flags: 'w' }) // new file
    })
}).on('error', () => console.log("cannot create debug.log"))
