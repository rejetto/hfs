// This file is part of HFS - Copyright 2026, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { readFile } from 'fs/promises'
import Koa from 'koa'
import { CFG, Dict, tryJson } from './misc'
import { defineConfig } from './config'
import { expiringCache } from './expiringCache'
import ADMIN_TRANSLATIONS from './admin-langs/embedded'
import { EMBEDDED_LANGUAGE } from './const'
import { code2file, file2code, normalizeLangCode } from './lang'
import glob from 'fast-glob'
import _ from 'lodash'

export async function getAdminLangs() {
    const files = await glob(code2file('*', true))
    return _.uniq([...Object.keys(ADMIN_TRANSLATIONS), ...files.map(name => file2code(name, true))
        .filter(code => normalizeLangCode(code) === code)])
}

export const adminLang = defineConfig(CFG.admin_lang, '', normalizeLangCode)

const cache = expiringCache<Dict>(3_000)
export function getAdminLangData(ctx: Koa.Context, langs: string[]) {
    const configured = adminLang.compiled()
    const code = langs.includes(configured) ? configured : browserAdminLang(ctx, langs)
    return cache.try(code, async () => ({
        [code]: tryJson(await readFile(code2file(code, true), 'utf8').catch(() => ''))
            || ADMIN_TRANSLATIONS[code as keyof typeof ADMIN_TRANSLATIONS] || ADMIN_TRANSLATIONS.en,
        ...code === EMBEDDED_LANGUAGE ? {} : { [EMBEDDED_LANGUAGE]: ADMIN_TRANSLATIONS.en },
    }))
}

export function invalidateAdminLang(code: string) {
    cache.delete(code) // uploads and deletions must be visible immediately after the Admin reloads
}

function browserAdminLang(ctx: Koa.Context | undefined, langs: string[]) {
    const accepted = ctx?.get('Accept-Language') || ''
    for (const raw of accepted.split(',')) {
        const code = normalizeLangCode(raw)
        if (langs.includes(code)) return code
        const base = code.split('-')[0] || ''
        if (langs.includes(base)) return base
    }
    return EMBEDDED_LANGUAGE
}
