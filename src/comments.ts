import { defineConfig } from './config'
import { dirname, join } from 'path'
import { basename } from './cross'
import { parseFile, parseFileCache } from './util-files'
import { writeFile } from 'fs/promises'
import { singleFromBatch } from './misc'
import _ from 'lodash'
import iconv from 'iconv-lite'

export const DESCRIPT_ION = 'descript.ion'
export const descriptIon = defineConfig('descript_ion', true)
const descriptIonEncoding = defineConfig('descript_ion_encoding', 'utf8')

export async function getCommentFor(path?: string) {
    return !path || !descriptIon.get() ? undefined
        : readDescription(dirname(path)).then(x => x.get(basename(path)), () => undefined)
}

export const setCommentFor = singleFromBatch(async (jobs: [path: string, comment: string][]) => {
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
        let txt = ''
        comments.forEach((c, f) =>
            txt += (f.includes(' ') ? `"${f}"` : f) + ' ' + (c.includes('\n') ? c.replaceAll('\n', '\\n') + MULTILINE_SUFFIX : c) + '\n')
        const buffer = iconv.encode(txt, descriptIonEncoding.get())
        await writeFile(join(folder, DESCRIPT_ION), buffer)
    }))
})

export function areCommentsEnabled() {
    return descriptIon.get()
}

const MULTILINE_SUFFIX = '\x04\xc2'
function readDescription(path: string) {
    return parseFile(join(path, DESCRIPT_ION), raw =>
        // decoding could also be done with native TextDecoder.decode, but we need iconv for the encoding anyway
        new Map(iconv.decode(raw, descriptIonEncoding.get()).split('\n').map(line => {
            const quoted = line[0] === '"' ? 1 : 0
            const i = quoted ? line.indexOf('"', 2) + 1 : line.indexOf(' ')
            const fn = line.slice(quoted, i - quoted)
            let comment = line.slice(i + 1)
            if (comment.endsWith(MULTILINE_SUFFIX))
                comment = comment.slice(0, -2).replaceAll('\\n', '\n')
            return [fn, comment]
        })))
}

descriptIonEncoding.sub(() => { // invalidate cache at encoding change
    for (const k of parseFileCache.keys())
        if (k.endsWith(DESCRIPT_ION))
            parseFileCache.delete(k)
})