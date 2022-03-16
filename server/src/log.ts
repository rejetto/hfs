// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { Writable } from 'stream'
import { defineConfig, getConfig, subscribeConfig } from './config'
import { createWriteStream } from 'fs'
import * as util from 'util'
import { rename, stat } from 'fs/promises'
import { DAY } from './const'

class Logger {
    stream?: Writable
    last?: Date
    path: string = ''

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
        this.stream = createWriteStream(this.path, { flags: 'a' })
    }
}

const accessLogger = new Logger()
const errorLogger = new Logger()

subscribeConfig({ k: 'log', defaultValue: 'access.log' }, path => {
    console.debug('log file: ' + (path || 'disabled'))
    accessLogger.setPath(path)
})

subscribeConfig({ k: 'error_log', defaultValue: 'error.log' }, path => {
    console.debug('error log: ' + (path || 'disabled'))
    errorLogger.setPath(path)
})

function getMidnight(date: Date=new Date) {
    date.setHours(0,0,0,0)
    return date
}

defineConfig('log_rotation', { defaultValue: 'weekly' })

export function log(): Koa.Middleware {
    return async (ctx, next) => {  // wrapping in a function will make it use current 'mw' value
        await next()
        const isError = ctx.status >= 400
        const logger = isError && errorLogger || accessLogger
        const freq = getConfig('log_rotation')?.[0]
        const { stream, last, path } = logger
        if (!stream) return
        const now = new Date()
        const a = now.toString().split(' ')
        if (freq && last) {
            const passed = Number(now) - Number(last)
                - 3600_000 // be pessimistic and count a possible DST change
            if (freq === 'm' && (passed >= 31*DAY || now.getMonth() !== last.getMonth())
            || freq === 'd' && (passed >= DAY || now.getDate() !== last.getDate())
            || freq === 'w' && (passed >= 7*DAY || now.getDay() < last.getDay())) {
                stream.end()
                const postfix = last.getFullYear() + '-' + doubleDigit(last.getMonth() + 1) + '-' + doubleDigit(last.getDate())
                await rename(path, path + '-' + postfix)
                logger.reopen()
            }
        }
        logger.last = now
        const format = '%s - - [%s] "%s %s HTTP/%s" %d %s\n';
        const date = a[2]+'/'+a[1]+'/'+a[3]+':'+a[4]+' '+a[5].slice(3)
        logger.stream!.write(util.format( format,
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
