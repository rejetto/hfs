import Koa from 'koa'
import { hasProp, onlyTruthy, tryJson, wantArray } from './misc'
import { readFile } from 'fs/promises'
import { defineConfig } from './config'
import { watchLoad } from './watchLoad'
import EMBEDDED_TRANSLATIONS from './langs/embedded'
import { mapPlugins } from './plugins'
import { join } from 'path'
import _ from 'lodash'

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
    const param = String(ctx.query.lang || '')
    if (!param && forceLangData)
        return forceLangData
    const ret: any = {}
    const csv = param || ctx.get('Accept-Language') || ''
    const langs = wantArray(csv.split(',').map(x => x.toLowerCase()))
    let i = 0
    while (i < langs.length) {
        let k = langs[i] || '' // shut up ts
        if (!k || k === EMBEDDED_LANGUAGE) break
        const fn = code2file(k)
        try { ret[k] = JSON.parse(await readFile(fn, 'utf8')) }
        catch {
            if (hasProp(EMBEDDED_TRANSLATIONS, k))
                ret[k] = EMBEDDED_TRANSLATIONS[k]
            else {
                do { k = k.substring(0, k.lastIndexOf('-'))
                } while (k && langs.includes(k))
                if (k) {
                    langs[i] = k // overwrite and retry
                    continue
                }
            }
        }
        const fromPlugins = onlyTruthy(await Promise.all(mapPlugins(async pl =>
            tryJson(await readFile(join(pl.folder, fn), 'utf8').catch(() => ''))?.translate )))
        if (fromPlugins.length)
            _.defaults((ret[k] ||= {}).translate ||= {}, ...fromPlugins) // be sure we have an entry for k

        i++
    }
    return ret
}

let forceLangData: any
let undo: any
defineConfig('force_lang', '', v => {
    undo?.()
    if (!v)
        return forceLangData = undefined
    const translation = (EMBEDDED_TRANSLATIONS as any)[v]
    forceLangData = { [v]: translation }
    if (v === EMBEDDED_LANGUAGE) return
    const res = watchLoad(code2file(v), data => {
        forceLangData = { [v]: tryJson(data) || translation }
    })
    undo = res.unwatch
})

