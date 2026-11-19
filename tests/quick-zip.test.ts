import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import unzipper from 'unzipper'
import { QuickZipStream } from '../src/QuickZipStream'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'

test('zip rejects late directory errors and closes the iterator', async () => {
    let closed = false
    const error = Error('rejected search')
    const zip = new QuickZipStream((async function* () {
        try {
            yield { path: 'first.txt', size: 0 }
            throw error
        }
        finally { closed = true }
    })())
    await zip.calculateSize(0)
    await assert.rejects(async () => {
        for await (const _chunk of zip) { /* consume until the directory error */ }
    }, error)
    assert.equal(closed, true)
    assert.equal(zip.destroyed, true)
})

test('zip central directory resumes after backpressure', async () => {
    const zip = new QuickZipStream((async function* () {
        for (let i = 0; i < 1000; i++)
            yield { path: 'directory/'.repeat(8) + i + '.txt' }
    })())
    const chunks: Buffer[] = []
    const done = once(zip, 'end', { signal: AbortSignal.timeout(5000) })
    await new Promise<void>(resolve => {
        zip.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
            if (chunk.length >= 4 && chunk.readUInt32LE(0) === 0x02014b50) {
                zip.pause()
                resolve()
            }
        })
    })
    assert.ok(zip.readableLength <= zip.readableHighWaterMark + 256)
    zip.removeAllListeners('data')
    zip.on('data', chunk => chunks.push(chunk))
    zip.resume()
    await done
    assert.equal((await unzipper.Open.buffer(Buffer.concat(chunks))).files.length, 1000)
})

test('zip.abort closes the directory iterator', async () => {
    let iteratorClosed = false
    const source = new PassThrough()
    const zip = new QuickZipStream((async function* () {
        try {
            yield { path: 'first.txt', size: 100000, getData: () => source }
            yield { path: 'second.txt', size: 0 }
        }
        finally { iteratorClosed = true }
    })())
    const reading = once(source, 'resume', { signal: AbortSignal.timeout(1000) })
    zip.read(1)
    await reading
    const closed = once(zip, 'close', { signal: AbortSignal.timeout(1000) })
    zip.destroy()
    await closed
    assert.equal(source.destroyed, true)
    assert.equal(iteratorClosed, true)
})

for (const [name, budget] of [['zero budget', 0], ['expired budget', 10], ['complete calculation', 10000]] as const) {
    test(`zip.size calculation preserves all files: ${name}`, async () => {
        const paths = ['alfa.txt', 'page/gpl.png', 'page/index.html']
        const zip = new QuickZipStream((async function* () {
            for (const [index, path] of paths.entries()) {
                if (index === 1)
                    await delay(30) // a slow enumeration must only stop calculating size, not the download
                const source = resolve(__dirname, path)
                yield { path, size: statSync(source).size, getData: () => createReadStream(source) }
            }
        })())
        const calculatedSize = await zip.calculateSize(budget)
        const chunks: Buffer[] = []
        for await (const chunk of zip)
            chunks.push(chunk)
        const buffer = Buffer.concat(chunks)
        if (budget < 30)
            assert.ok(Number.isNaN(calculatedSize))
        else
            assert.equal(calculatedSize, buffer.length)
        const archive = await unzipper.Open.buffer(buffer)
        assert.deepEqual(archive.files.map(file => file.path), paths)
        for (const file of archive.files)
            assert.deepEqual(await file.buffer(), readFileSync(resolve(__dirname, file.path)))
    })
}
