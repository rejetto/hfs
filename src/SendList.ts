import { Readable } from 'stream'
import _ from 'lodash'
import { LIST, wantArray } from './cross'
import { Context } from 'koa'
import events from './events'

type SendListFunc<T> = (list:SendListReadable<T>) => void
// offer an api for a generic dynamic list. Suitable to be the result of an api.
export class SendListReadable<T> extends Readable {
    protected lastError: string | number | undefined
    protected buffer: any[] = []
    protected processBuffer: _.DebouncedFunc<any>
    protected sent: undefined | T[]
    constructor({ addAtStart, doAtStart, bufferTime, onEnd, diff }:
                    { bufferTime?: number, addAtStart?: T[], doAtStart?: SendListFunc<T>, onEnd?: SendListFunc<T>, diff?: boolean }={}) {
        super({ objectMode: true, read(){} })
        if (!bufferTime)
            bufferTime = 200
        if (diff)
            this.sent = []
        this.processBuffer = _.debounce(() => {
            const {sent} = this
            if (sent)
                this.buffer = this.buffer.filter(([cmd, a, b]) => {
                    if (cmd === LIST.add)
                        return sent.push(...wantArray(a))
                    if (cmd === LIST.remove)
                        return _.remove(sent, a)
                    if (cmd !== LIST.update)
                        return true
                    const found = _.find(sent, a) as any
                    if (!found) return
                    for (const k in b)
                        if (b[k] === found[k])
                            delete b[k]
                        else {
                            found[k] = b[k]
                            b[k] ??= null // go and delete it, remotely
                        }
                    return !_.isEmpty(b)
                })
            if (!this.buffer.length) return
            this.push(this.buffer)
            this.buffer = []
        }, bufferTime, { maxWait: bufferTime })
        this.on('close', () => {
            onEnd?.(this)
            this.destroy()
        })
        setTimeout(() => doAtStart?.(this)) // work later, when list object has been received by Koa
        if (addAtStart) {
            for (const x of addAtStart)
                this.add(x)
            this.ready()
        }
    }
    protected _push(rec: any) {
        this.buffer.push(rec)
        if (this.buffer.length > 10_000) // hard limit
            this.processBuffer.flush()
        else
            this.processBuffer()
    }
    add(rec: T) {
        this._push([LIST.add, rec])
    }
    remove(search: Partial<T>) {
        const match = _.matches(search)
        const idx = _.findIndex(this.buffer, x => match(x[1]))
        const found = this.buffer[idx]
        const op = found?.[0]
        if (op === LIST.remove) return
        if (found) {
            this.buffer.splice(idx, 1)
            if (op === LIST.add) return // assuming this never reached the client
        }
        this._push([LIST.remove, search])
    }
    update(search: Partial<T>, change: Partial<T>) {
        if (_.isEmpty(change)) return
        const match = _.matches(search)
        const found = _.find(this.buffer, x => match(x[1]))
        const op = found?.[0]
        if (op === LIST.remove) return
        if (op === LIST.add || op === LIST.update)
            return Object.assign(found[op === LIST.add ? 1 : 2], change)
        this._push([LIST.update, search, change])
    }
    ready() { // useful to indicate the end of an initial phase, but we leave open for updates
        this._push([LIST.ready])
    }
    custom(name: string, data: any) {
        this._push(data === undefined ? [name] : [name, data])
    }
    props(props: object) {
        this._push([LIST.props, props])
    }
    error(msg: NonNullable<typeof this.lastError>, close=false, props?: object) {
        this._push([LIST.error, msg, props])
        this.lastError = msg
        if (close)
            this.close()
    }
    getLastError() {
        return this.lastError
    }
    close() {
        this.processBuffer.flush()
        this.push(null)
    }
    events(ctx: Context, eventMap: Parameters<typeof events.multi>[0]) {
        ctx.res.once('close', events.multi(eventMap))
        return this
    }
    isClosed() {
        return this.destroyed
    }
}
