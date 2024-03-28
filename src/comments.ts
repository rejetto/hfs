import { defineConfig } from './config'
import { dirname, join } from 'path'
import { basename } from './cross'
import { parseFile, parseFileCache } from './util-files'
import { createWriteStream } from 'fs'
import { singleWorkerFromBatchWorker } from './misc'
import _ from 'lodash'
import iconv from 'iconv-lite'

export const DESCRIPT_ION = 'descript.ion'
export const descriptIon = defineConfig('descript_ion', true)
const descriptIonEncoding = defineConfig('descript_ion_encoding', 'utf8')

export async function getCommentFor(path?: string) {
    return !path || !descriptIon.get() ? undefined
        : readDescription(dirname(path)).then(x => x.get(basename(path)), () => undefined)
}

export const setCommentFor = singleWorkerFromBatchWorker(async (jobs: [path: string, comment: string][]) => {
    const byFolder = _.groupBy(jobs, job => dirname(job[0]))
    return Promise.allSettled(_.map(byFolder, async (jobs, folder) => {
        const comments = await readDescription(folder).catch(() => new Map())
        for (const [path, comment] of jobs) {
            const file = path.slice(folder.length + 1)
            if (!comment)
                comments.delete(file)
            else
                comments.set(file, comment)
        }
        // encode comments in descript.ion format
        const ws = createWriteStream(join(folder, DESCRIPT_ION))
        comments.forEach((comment, filename) => {
            const multiline = comment.includes('\n')
            const line = (filename.includes(' ') ? `"${filename}"` : filename)
                + ' ' + (multiline ? comment.replaceAll('\n', '\\n') : comment)
            ws.write( iconv.encode(line, descriptIonEncoding.get()) )
            if (multiline)
                ws.write(MULTILINE_SUFFIX, 'binary')
            ws.write('\n')
        })
    }))
})

export function areCommentsEnabled() {
    return descriptIon.get()
}

const MULTILINE_SUFFIX = Buffer.from([4, 0xC2])
function readDescription(path: string) {
    // decoding could also be done with native TextDecoder.decode, but we need iconv for the encoding anyway
    return parseFile(join(path, DESCRIPT_ION), raw => {
        // for simplicity we "remove" the sequence MULTILINE_SUFFIX before iconv.decode messes it up
        for (let i=0; i<raw.length; i++)
            if (raw[i] === MULTILINE_SUFFIX[0] && raw[i+1] === MULTILINE_SUFFIX[1] && [undefined,13,10].includes(raw[i+2]))
                raw[i] = raw[i+1] = 10
        const decoded = iconv.decode(raw, descriptIonEncoding.get())
        const ret = new Map(decoded.split('\n').map(line => {
            const quoted = line[0] === '"' ? 1 : 0
            const i = quoted ? line.indexOf('"', 2) + 1 : line.indexOf(' ')
            const fn = line.slice(quoted, i - quoted)
            const comment = line.slice(i + 1).replaceAll('\\n', '\n')
            return [fn, comment]
        }))
        ret.delete('')
        return ret
    })
}

descriptIonEncoding.sub(() => { // invalidate cache at encoding change
    for (const k of parseFileCache.keys())
        if (k.endsWith(DESCRIPT_ION))
            parseFileCache.delete(k)
})