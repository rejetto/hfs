import { Transform, TransformCallback } from 'stream'
import { TokenBucket } from 'limiter'

// throttled stream
export class ThrottledStream extends Transform {

    private sent: number = 0
    private lastSpeed: number = 0
    private lastSpeedTime = Date.now()

    constructor(private group: ThrottleGroup) {
        super()
    }

    async _transform(chunk: any, encoding: BufferEncoding, done: TransformCallback) {
        let pos = 0
        while (1) {
            const slice = chunk.slice(pos, pos + this.group.getMin() / 10)
            const n = slice.length
            if (!n) // we're done here
                return done()
            try {
                await this.group.consume(n)
                this.push(slice)
                this.sent += n
                pos += n
            } catch (e) {
                done(e as Error)
                return
            }
        }
    }

    // @return kBs
    getSpeed(): number {
        const now = Date.now()
        const past = now - this.lastSpeedTime
        if (past >= 1000) { // recalculate?
            this.lastSpeedTime = now
            this.lastSpeed = this.sent / past
            this.sent = 0
        }
        return this.lastSpeed
    }
}

export class ThrottleGroup {

    private bucket?: TokenBucket

    constructor(public kBs: number, parent?: ThrottleGroup) {
        this.updateLimit(kBs)
        if (parent)
            this.bucket!.parentBucket = parent.bucket
    }

    // @return kBs
    getLimit() {
        return this.bucket!.bucketSize / 1000
    }

    updateLimit(kBs: number) {
        if (kBs < 0)
            throw new Error('invalid bytesPerSecond')
        kBs *= 1000
        this.bucket = new TokenBucket({
            bucketSize: kBs,
            tokensPerInterval: kBs,
            interval: 'second',
            parentBucket: this.bucket?.parentBucket,
        })
    }

    getMin() {
        let b: TokenBucket | undefined = this.bucket
        let ret = b!.bucketSize
        while (b = b!.parentBucket)
            ret = Math.min(ret, b.bucketSize)
        return ret
    }

    consume(n: number) {
        return this.bucket!.removeTokens(n)
    }
}
