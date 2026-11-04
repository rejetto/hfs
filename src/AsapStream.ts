import { Readable } from 'stream'
import { isAsyncIterable, Promisable } from './cross'

// produces as promises resolve, not sequentially
export class AsapStream<T> extends Readable {
    readingStarted = false
    constructor(private promises: Iterable<Promisable<T>> | AsyncIterable<Promisable<T>>) {
        super({ objectMode: true })
    }
    _read() {
        if (this.readingStarted) return
        this.readingStarted = true
        // local function below has its own this
        const stream = this
        void (async () => {
            const pending: Promise<T>[] = []
            try {
                if (!isAsyncIterable(this.promises))
                    for (const p of this.promises)
                        track(p)
                else {
                    const iterator = this.promises[Symbol.asyncIterator]()
                    while (true) {
                        const { value, done } = await iterator.next()
                        if (done) break
                        track(value)
                    }
                }
                await Promise.allSettled(pending)
                this.push(null)
            }
            catch (e) {
                this.emit('error', e)
                this.push(null)
            }

            function track(p: Promisable<T>) {
                const promise = Promise.resolve(p)
                pending.push(promise)
                promise.then(x => {
                    if (x !== undefined)
                        stream.push(x)
                }, e => stream.emit('error', e))
            }
        })()
    }
}
