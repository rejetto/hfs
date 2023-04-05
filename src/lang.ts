import Koa from 'koa'
import { wantArray } from './misc'
import { readFile } from 'fs/promises'
import { defineConfig } from './config'
import { watchLoad } from './watchLoad'

const PREFIX = 'hfs-lang-'
const SUFFIX = '.json'
const EMBEDDED = 'en'

export function code2file(code: string) {
    return PREFIX + code.toLowerCase() + SUFFIX
}

export function file2code(fn: string) {
    return fn.slice(PREFIX.length, -SUFFIX.length)
}

export async function getLangData(ctx: Koa.Context) {
    if (forceLangData)
        return forceLangData
    const ret: any = {}
    const csv = String(ctx.query.lang||'') || ctx.get('Accept-Language') || ''
    const langs = wantArray(csv.split(',').map(x => x.toLowerCase()))
    let i = 0
    while (i < langs.length) {
        let k = langs[i] || '' // shut up ts
        if (!k || k === EMBEDDED) break
        try { ret[k!] = JSON.parse(await readFile(`hfs-lang-${k}.json`, 'utf8')) }
        catch {
            do { k = k.substring(0, k.lastIndexOf('-'))
            } while (k && langs.includes(k))
            if (k) {
                langs[i] = k // overwrite and retry
                continue
            }
        }
        i++
    }
    return ret
}

let forceLangData: any
let undo: any
defineConfig('force_lang', '', v => {
    undo?.()
    forceLangData = undefined
    if (!v) return
    const res = watchLoad(code2file(v), data => {
        forceLangData = { [v]: JSON.parse(data) }
    })
    undo = res.unwatch
})

