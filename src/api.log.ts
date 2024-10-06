import { ApiHandlers } from './apiMiddleware'
import _ from 'lodash'
import { consoleLog } from './consoleLog'
import { HTTP_NOT_ACCEPTABLE, HTTP_NOT_FOUND, wait } from './cross'
import events from './events'
import { loggers } from './log'
import { SendListReadable } from './SendList'
import { forceDownload, serveFile } from './serveFile'
import { ips } from './ips'

export default {
    async get_log_file({ file = 'log', range = '' }, ctx) { // this is limited to logs on file, and serves the file instead of a list of records
        const log = _.find(loggers, { name: file })
        if (!log)
            throw HTTP_NOT_FOUND
        if (!log.path)
            throw HTTP_NOT_ACCEPTABLE
        forceDownload(ctx, log.path)
        if (range)
            ctx.request.header.range = `bytes=${range}`
        if (ctx.method === 'POST') // this would cause method_not_allowed
            ctx.method = 'GET'
        await serveFile(ctx, log.path)
        return null
    },

    get_log({ file = 'log' }, ctx) {
        const files = file.split('|') // potentially more then one
        return new SendListReadable({
            bufferTime: 10,
            async doAtStart(list) {
                if (file === 'ips') {
                    for await (const [k, v] of ips.iterator())
                        list.add({ ip: k, ...v })
                    list.ready()
                    return
                }
                if (file === 'console') {
                    for (const chunk of _.chunk(consoleLog, 1000)) { // avoid occupying the thread too long
                        for (const x of chunk)
                            list.add(x)
                        await wait(0)
                    }
                    list.ready()
                    ctx.res.once('close', events.on('console', x => list.add(x)))
                    return
                }
                // for other logs we only provide updates. Use get_log_file to download past content
                if (_.some(files, x => !_.find(loggers, { name: x })) )
                    return list.error(HTTP_NOT_FOUND, true)
                list.ready()
                // unsubscribe when connection is interrupted
                ctx.res.once('close', events.on(files, x => list.add(x)))
            }
        })

    },

    reset_ips() {
        return ips.clear()
    },

} satisfies ApiHandlers