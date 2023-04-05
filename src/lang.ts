import Koa from 'koa'
import { wantArray } from './misc'
import { readFile } from 'fs/promises'
import { defineConfig } from './config'
import { watchLoad } from './watchLoad'

const PREFIX = 'hfs-lang-'
const SUFFIX = '.json'
const EMBEDDED_LANGUAGE = 'en'

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
        if (!k || k === EMBEDDED_LANGUAGE) break
        try { ret[k!] = JSON.parse(await readFile(`hfs-lang-${k}.json`, 'utf8')) }
        catch {
            if (k in EMBEDDED_TRANSLATIONS)
                ret[k] = EMBEDDED_TRANSLATIONS[k as keyof typeof EMBEDDED_TRANSLATIONS]
            else {
                do { k = k.substring(0, k.lastIndexOf('-'))
                } while (k && langs.includes(k))
                if (k) {
                    langs[i] = k // overwrite and retry
                    continue
                }
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


import lang_it from './langs/hfs-lang-it.json'
import lang_zh from './langs/hfs-lang-zh.json'
import lang_ru from './langs/hfs-lang-ru.json'
import lang_sr from './langs/hfs-lang-sr.json'
import lang_ko from './langs/hfs-lang-ko.json'

export const EMBEDDED_TRANSLATIONS = {
    it: lang_it,
    zh: lang_zh,
    ru: lang_ru,
    sr: lang_sr,
    ko: lang_ko,
}

