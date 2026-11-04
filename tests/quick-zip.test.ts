import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import unzipper from 'unzipper'
import { QuickZipStream } from '../src/QuickZipStream'

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
