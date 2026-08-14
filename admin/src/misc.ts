// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { HTTP_MESSAGES, isEqualLax, MD_TAGS, md as sharedMd } from '@hfs/shared'
import { Link } from '@mui/material'
import httpCodes from './httpCodes'
import { language, t, translateText } from './i18n'
export * from '@hfs/shared'

;(MD_TAGS as any).a = Link

export function md(text: string | TemplateStringsArray, options?: Parameters<typeof sharedMd>[1]) {
    return sharedMd(typeof text === 'string' ? translateText(text) : text, options)
}

export function err2msg(code: string | number) {
    const permPath = typeof code === 'string' && code.split("Error: EPERM: operation not permitted, access ")[1]?.split('\n')[0]
    if (permPath)
        return t("Access denied on disk for {permPath}", { permPath: permPath })
    const known = {
        github_quota: 'github_quota_error',
        ENOENT: 'not_found',
        ENOTDIR: 'not_a_folder',
    }[code]
    return known ? t(known) : translateText(HTTP_MESSAGES[code as any] || httpCodes[code] || String(code)) // prefer short form, as httpCodes is quite long
}

export function formatTimestamp(x: number | string | Date) {
    return !x ? '' : (x instanceof Date ? x : new Date(x)).toLocaleString(language)
}

export function isModifiedConfig(a: any, b: any) {
    return !isEqualLax(a, b, (a,b) => !a && !b || undefined)
}
