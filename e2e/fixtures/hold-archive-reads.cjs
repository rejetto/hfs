const fs = require('node:fs')
const { basename } = require('node:path')
const { Readable } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')

module.exports = function holdArchiveReads(archives, releaseFile) {
    const createReadStream = fs.createReadStream
    fs.createReadStream = function(path, options) {
        const source = createReadStream.call(this, path, options)
        if (!options?.signal || !archives.includes(basename(String(path)))) return source
        // hold after real bytes reach the extractor so cancellation and overlap do not depend on disk speed
        return Readable.from((async function* () {
            let first = true
            for await (const chunk of source) {
                if (!first) {
                    while (!fs.existsSync(releaseFile)) {
                        options.signal.throwIfAborted()
                        await delay(10)
                    }
                }
                first = false
                yield chunk
            }
        })(), { objectMode: false, signal: options.signal })
    }
}
