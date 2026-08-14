// This file is part of HFS - Copyright 2026, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { readFile } from 'fs/promises'
import Koa from 'koa'
import { CFG, Dict, tryJson } from './misc'
import { defineConfig } from './config'
import { expiringCache } from './expiringCache'
import ADMIN_TRANSLATIONS from './admin-langs/embedded'
import { EMBEDDED_LANGUAGE } from './const'
import { normalizeLangCode } from './lang'

const PREFIX = 'hfs-admin-lang-'
const SUFFIX = '.json'

export const adminLangs = Object.keys(ADMIN_TRANSLATIONS)
export const adminLang = defineConfig(CFG.admin_lang, '', code =>
    adminLangs.includes(code) ? code : '')

const cache = expiringCache<Dict>(3_000)
export function getAdminLangData(ctx?: Koa.Context) {
    const code = adminLang.compiled() || browserAdminLang(ctx) || EMBEDDED_LANGUAGE
    return cache.try(code, async () => ({
        [code]: tryJson(await readFile(PREFIX + code + SUFFIX, 'utf8').catch(() => ''))
            || ADMIN_TRANSLATIONS[code as keyof typeof ADMIN_TRANSLATIONS],
        ...code === EMBEDDED_LANGUAGE ? {} : { [EMBEDDED_LANGUAGE]: ADMIN_TRANSLATIONS.en },
    }))
}

function browserAdminLang(ctx?: Koa.Context) {
    const accepted = ctx?.get('Accept-Language') || ''
    for (const raw of accepted.split(',')) {
        const code = normalizeLangCode(raw)
        if (adminLangs.includes(code)) return code
        const base = code.split('-')[0] || ''
        if (adminLangs.includes(base)) return base
    }
    return EMBEDDED_LANGUAGE
}
