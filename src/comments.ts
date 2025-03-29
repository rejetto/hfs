import { defineConfig } from './config'
import { dirname, basename, join } from 'path'
import { CFG } from './cross'
import { parseFileContent, parseFileCache } from './util-files'
import { createWriteStream } from 'fs'
import { loadFileAttr, singleWorkerFromBatchWorker, storeFileAttr } from './misc'
import _ from 'lodash'
import iconv from 'iconv-lite'
import { unlink } from 'node:fs/promises'

export const DESCRIPT_ION = 'descript.ion'
const commentsStorage = defineConfig<'' | 'attr' | 'attr+ion'>(CFG.comments_storage, '')
defineConfig('descript_ion', true, (v, more) => { // legacy: convert previous setting
    if (!v && more.version?.olderThan('0.57.0-alpha1'))
        commentsStorage.set('attr')
})
const descriptIonEncoding = defineConfig('descript_ion_encoding', 'utf8')

function readFromDescriptIon(path: string) {
    return usingDescriptIon() && readDescriptIon(dirname(path)).then(x => x.get(basename(path)), () => undefined)
}

export function usingDescriptIon() {
    return ['', 'attr+ion'].includes(commentsStorage.get())
}

const COMMENT_ATTR = 'comment'

export async function getCommentFor(path?: string) {
    return !path ? undefined : Promise.all([
        commentsStorage.get() ? loadFileAttr(path, COMMENT_ATTR) : undefined,
        readFromDescriptIon(path)
    ]).then(([fromAttr, fromIon]) => fromAttr || fromIon)
}

export async function setCommentFor(path: string, comment: string) {
    if (commentsStorage.get()) {
        await storeFileAttr(path, COMMENT_ATTR, comment || undefined)
        return setCommentDescriptIon(path, '')
    }
    return setCommentDescriptIon(path, comment) // should we also remove from file-attr? not sure, but for the time we won't because #1 storeFileAttr is not really deleting, and we would store a lot of empty attributes, #2 more people will switch from descript.ion to attr (because introduced later) than the opposite
}

const setCommentDescriptIon = singleWorkerFromBatchWorker(async (jobs: [path: string, comment: string][]) => {
    const byFolder = _.groupBy(jobs, job => dirname(job[0]))
    return Promise.allSettled(_.map(byFolder, async (jobs, folder) => {
        const comments = await readDescriptIon(folder).catch(() => new Map())
        for (const [path, comment] of jobs) {
            const file = path.slice(folder.length + 1)
            if (!comment)
                comments.delete(file)
            else
                comments.set(file, comment)
        }
        const path = join(folder, DESCRIPT_ION)
        if (!comments.size)
            return unlink(path)
        // encode comments in descript.ion format
        const ws = createWriteStream(path)
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
    return true // true since we introduced comments in file-attr
}

const MULTILINE_SUFFIX = Buffer.from([4, 0xC2])
function readDescriptIon(path: string) {
    // decoding could also be done with native TextDecoder.decode, but we need iconv for the encoding anyway
    return parseFileContent(join(path, DESCRIPT_ION), raw => {
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