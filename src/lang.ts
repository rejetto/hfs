import Koa from 'koa'
import { CFG, hasProp, onlyTruthy, tryJson } from './misc'
import { expiringCache } from './expiringCache'
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
    return fn.replace(PREFIX, '').replace(SUFFIX, '')
}

const cache = expiringCache(3_000) // 3 seconds for both a good dx and acceptable performance
export async function getLangData(ctxOrLangCsv: Koa.Context | string) {
    if (typeof ctxOrLangCsv !== 'string') {
        const ctx = ctxOrLangCsv
        const param = String(ctx.query.lang || '')
        if (!param && forceLangData)
            return forceLangData
        ctxOrLangCsv = param || ctx.get('Accept-Language') || ''
    }
    const csv = ctxOrLangCsv.toLowerCase()
    return cache.try(csv, async () => {
        const langs = csv.split(',')
        const ret: any = {}
        let i = 0
        while (i < langs.length) {
            let k = langs[i] || '' // shut up ts
            if (!k || k === EMBEDDED_LANGUAGE) break
            const fn = code2file(k)
            try { ret[k] = JSON.parse(await readFile(fn, 'utf8')) } // allow external files to override embedded translations
            catch {
                if (hasProp(EMBEDDED_TRANSLATIONS, k))
                    ret[k] = _.cloneDeep(EMBEDDED_TRANSLATIONS[k])
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
    })
}

let forceLangData: any
let undo: any
defineConfig(CFG.force_lang, '', v => {
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

