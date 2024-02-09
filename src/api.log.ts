import { ApiHandlers } from './apiMiddleware'
import _ from 'lodash'
import { consoleLog } from './consoleLog'
import { HTTP_NOT_ACCEPTABLE, HTTP_NOT_FOUND, wait } from './cross'
import events from './events'
import { loggers } from './log'
import { onOff } from './misc'
import { SendListReadable } from './SendList'
import { serveFile } from './serveFile'

export default {
    async get_log_file({ file = 'log', range = '' }, ctx) {
        const log = _.find(loggers, { name: file })
        if (!log)
            throw HTTP_NOT_FOUND
        if (!log.path)
            throw HTTP_NOT_ACCEPTABLE
        ctx.attachment(log.path)
        if (range)
            ctx.request.header.range = `bytes=${range}`
        if (ctx.method === 'POST') // this would cause method_not_allowed
            ctx.method = 'GET'
        await serveFile(ctx, log.path)
        return null
    },

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
                if (!_.find(loggers, { name: file }))
                    return list.error(HTTP_NOT_FOUND, true)
                list.ready()
                ctx.res.once('close', onOff(events, { // unsubscribe when connection is interrupted
                    [file](entry) {
                        list.add(entry)
                    }
                }))
            }
        })

    },
} satisfies ApiHandlers