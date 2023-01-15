// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Transform, TransformCallback } from 'stream'
import { TokenBucket } from 'limiter'

// throttled stream
export class ThrottledStream extends Transform {

    private sent: number = 0
    private lastSpeed: number = 0
    private lastSpeedTime = Date.now()
    private totalSent: number = 0 // total sent over connection, since connection can be re-used for multiple requests

    constructor(private group: ThrottleGroup, copyStats?: ThrottledStream) {
        super()
        if (!copyStats) return
        this.sent = copyStats.sent
        this.totalSent = copyStats.totalSent
        this.lastSpeedTime = copyStats.lastSpeedTime
        this.lastSpeed = copyStats.lastSpeed
    }

    async _transform(chunk: any, encoding: BufferEncoding, done: TransformCallback) {
        let pos = 0
        while (1) {
            let n = this.group.suggestChunkSize()
            const slice = chunk.slice(pos, pos + n)
            n = slice.length
            if (!n) // we're done here
                return done()
            try {
                await this.group.consume(n)
                this.push(slice)
                this.sent += n
                this.totalSent += n
                pos += n
                this.emit('sent', n)
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

    getBytesSent() {
        return this.totalSent
    }
}

export class ThrottleGroup {

    private bucket: TokenBucket

    constructor(kBs: number, private parent?: ThrottleGroup) {
        this.bucket = this.updateLimit(kBs) // assignment is redundant and yet the best way I've found to shut up typescript
    }

    // @return kBs
    getLimit() {
        return this.bucket.bucketSize / 1000
    }

    updateLimit(kBs: number) {
        if (kBs < 0)
            throw new Error('invalid bytesPerSecond')
        kBs *= 1000
        return this.bucket = new TokenBucket({
            bucketSize: kBs,
            tokensPerInterval: kBs,
            interval: 'second',
        })
    }

    suggestChunkSize() {
        let b: TokenBucket | undefined = this.bucket
        b.parentBucket = this.parent?.bucket
        let min = b.bucketSize
        while (b = b.parentBucket)
            min = Math.min(min, b.bucketSize)
        return min / 10
    }

    consume(n: number) {
        return this.bucket.removeTokens(n)
    }
}
