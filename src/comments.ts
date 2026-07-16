import { defineConfig } from './config'
import { dirname, basename, join } from 'path'
import { CFG } from './cross'
import { parseFile, parseFileCache, createSafeWriteStream, exists } from './util-files'
import { loadFileAttr, singleWorkerFromBatchWorker, storeFileAttr } from './misc'
import _ from 'lodash'
import iconv from 'iconv-lite'
import { rm } from 'node:fs/promises'
import { finished } from 'stream/promises'
import { expiringCache } from './expiringCache'

export const DESCRIPT_ION = 'descript.ion'
export const DESCRIPT_ION_ALT = 'DESCRIPT.ION'
const commentsStorage = defineConfig<'' | 'attr' | 'attr+ion'>(CFG.comments_storage, '',
        v => ['', 'attr+ion'].includes(v)) // compiled tell us if we are using descript.ion
defineConfig(CFG.descript_ion, true, (v, more) => { // legacy: convert previous setting
    if (!v && more.version?.olderThan('0.57.0-alpha1'))
        commentsStorage.set('attr')
})
const descriptIonEncoding = defineConfig(CFG.descript_ion_encoding, 'utf8')

function readFromDescriptIon(path: string) {
    return usingDescriptIon() && readDescriptIon(dirname(path)).then(x => x.get(basename(path)), () => undefined)
}

export function usingDescriptIon() {
    return commentsStorage.compiled()
}

const COMMENT_ATTR = 'comment'

export async function getCommentFor(path?: string) {
    return !path ? undefined : Promise.all([
        commentsStorage.get() ? loadFileAttr(path, COMMENT_ATTR) : undefined,
        readFromDescriptIon(path)
    ]).then(([fromAttr, fromIon]) => fromAttr || fromIon || undefined)
}

export async function setCommentFor(path: string, comment: string) {
    if (commentsStorage.get())
        return prep(storeFileAttr(path, COMMENT_ATTR, comment || undefined)).then(v => {
            if (v)
                void setCommentDescriptIon(path, '').catch(() => {})
            return v
        })
    // should we also remove from file-attr, similarly as above we remove from descript.ion? not sure, but for the time we won't because #1 storeFileAttr is not really deleting, and we would store a lot of empty attributes, #2 more people will switch from descript.ion to attr (because introduced later) than the opposite
    return prep(setCommentDescriptIon(path, comment))

    function prep(p: Promise<any>): Promise<boolean> {
        return p.then(v => v !== false, (e: any) => {
            console.error(`${comment ? "Error setting comment" : "Error removing comment"}: ${String(e)}`)
            return false
        })
    }
}

const setCommentDescriptIon = singleWorkerFromBatchWorker((jobs: [path: string, comment: string][]) => {
    const byFolder = _.groupBy(jobs, job => dirname(job[0])) // jobs in the same folder share one write and its success or failure
    const resultByFolder = _.mapValues(byFolder, async (jobs, folder) => {
        const comments = await readDescriptIon(folder).catch(e => {
            if (e?.code !== 'ENOENT') throw e
            return new Map()
        })
        for (const [path, comment] of jobs) {
            const file = path.slice(folder.length + 1)
            if (!comment)
                comments.delete(file)
            else
                comments.set(file, comment)
        }
        const path = await filePathHelper(folder)
        if (!comments.size)
            return rm(path, { force: true })
        // encode comments in descript.ion format
        const ws = await createSafeWriteStream(path)
        comments.forEach((comment, filename) => {
            const multiline = comment.includes('\n')
            const line = (filename.includes(' ') ? `"${filename}"` : filename)
                + ' ' + (multiline ? comment.replaceAll('\n', '\\n') : comment)
            ws.write( iconv.encode(line, descriptIonEncoding.get()) )
            if (multiline)
                ws.write(MULTILINE_SUFFIX, 'binary')
            ws.write('\n')
        })
        ws.end()
        await finished(ws)
    })
    return jobs.map(([path]) => resultByFolder[dirname(path)])
})

export function areCommentsEnabled() {
    return true // true since we introduced comments in file-attr
}

async function filePathHelper(folder: string) {
    const main = join(folder, DESCRIPT_ION)
    const alt = join(folder, DESCRIPT_ION_ALT)
    return await exists(alt) && !await exists(main) ? alt : main
}

const MULTILINE_SUFFIX = Buffer.from([4, 0xC2])
const pathCache = expiringCache<Promise<string>>(2_000)
// this can be called many times when listing a folder, and we want to also not check too often as it can be expensive, especially on a networked drive
async function readDescriptIon(path: string) {
    return parseFile(await pathCache.try(path, filePathHelper), raw => {
        // for simplicity, we "remove" the sequence MULTILINE_SUFFIX before iconv.decode messes it up
        for (let i=0; i<raw.length; i++)
            if (raw[i] === MULTILINE_SUFFIX[0] && raw[i+1] === MULTILINE_SUFFIX[1] && [undefined,13,10].includes(raw[i+2]))
                raw[i] = raw[i+1] = 10
        // decoding could also be done with native TextDecoder.decode, but we need iconv for the encoding anyway
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
    }, 2000).then(x => x.content)
}

descriptIonEncoding.sub(() => { // invalidate cache at encoding change
    for (const k of parseFileCache.keys())
        if (k.endsWith(DESCRIPT_ION) || k.endsWith(DESCRIPT_ION_ALT))
            parseFileCache.delete(k)
})
