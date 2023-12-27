import { ApiHandlers } from './apiMiddleware'
import _ from 'lodash'
import { consoleLog } from './consoleLog'
import { HTTP_NOT_FOUND, tryJson, wait } from './cross'
import events from './events'
import { loggers } from './log'
import { createReadStream } from 'fs'
import readline from 'readline'
import { onOff } from './misc'
import { SendListReadable } from './SendList'

export default {
    get_log({ file = 'log' }, ctx) {
        return new SendListReadable({
            bufferTime: 10,
            async doAtStart(list) {
                if (file === 'console') {
                    for (const chunk of _.chunk(consoleLog, 1000)) { // avoid occupying the thread too long
                        for (const x of chunk)
                            list.add(x)
                        await wait(0)
                    }
                    list.ready()
                    events.on('console', x => list.add(x))
                    return
                }
                const logger = loggers.find(l => l.name === file)
                if (!logger)
                    return list.error(HTTP_NOT_FOUND, true)
                const input = createReadStream(logger.path)
                input.on('error', async (e: any) => {
                    if (e.code === 'ENOENT') // ignore ENOENT, consider it an empty log
                        return list.ready()
                    list.error(e.code || e.message)
                })
                input.on('end', () =>
                    list.ready())
                input.on('ready', () => {
                    readline.createInterface({ input }).on('line', line => {
                        if (ctx.aborted)
                            return input.close()
                        const obj = parse(line)
                        if (obj)
                            list.add(obj)
                    }).on('close', () => { // file is automatically closed, so we continue by events
                        ctx.res.once('close', onOff(events, { // unsubscribe when connection is interrupted
                            [logger.name](entry) {
                                list.add(entry)
                            }
                        }))
                    })
                })
            }
        })

        function parse(line: string) {
            const m = /^(.+?) (.+?) (.+?) \[(.{11}):(.{14})] "(\w+) ([^"]+) HTTP\/\d.\d" (\d+) (-|\d+) ?(.*)/.exec(line)
            if (!m) return
            const [, ip, , user, date, time, method, uri, status, length, extra] = m
            return { // keep object format same as events emitted by the log module
                ip,
                user: user === '-' ? undefined : user,
                ts: new Date(date + ' ' + time),
                method,
                uri,
                status: Number(status),
                length: length === '-' ? undefined : Number(length),
                extra: tryJson(tryJson(extra)) || undefined,
            }
        }
    },
} satisfies ApiHandlers