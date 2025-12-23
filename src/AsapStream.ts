import { Readable } from 'stream'
import { isAsyncIterable } from './cross'

// produces as promises resolve, not sequentially
export class AsapStream<T> extends Readable {
    finished = false
    constructor(private promises: Iterable<Promise<T> | T> | AsyncIterable<Promise<T> | T>) {
        super({ objectMode: true })
    }
    _read() {
        if (this.finished) return
        this.finished = true
        void (async () => {
            const pending: Promise<T>[] = []
            try {
                if (isAsyncIterable(this.promises)) {
                    const iterator = this.promises[Symbol.asyncIterator]()
                    while (true) {
                        const { value, done } = await iterator.next()
                        if (done) break
                        const promise = Promise.resolve(value)
                        pending.push(promise)
                        promise.then(x => x !== undefined && this.push(x),
                            e => this.emit('error', e) )
                    }
                }
                else {
                    for (const p of this.promises) {
                        const promise = Promise.resolve(p)
                        pending.push(promise)
                        promise.then(x => x !== undefined && this.push(x),
                        e => this.emit('error', e) )
                    }
                }
                await Promise.allSettled(pending)
                this.push(null)
            }
            catch (e) {
                this.emit('error', e)
                this.push(null)
            }
        })()
    }
}
