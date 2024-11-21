// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall } from './api'
import { HTTP_MESSAGES, MD_TAGS } from '@hfs/shared'
import { Link } from '@mui/material'
export * from '@hfs/shared'

;(MD_TAGS as any).a = Link

export async function manipulateConfig(k: string, work:(data:any) => any) {
    const cfg = await apiCall('get_config', { only: [k] })
    const was = cfg[k]
    const will = await work(was)
    if (JSON.stringify(was) !== JSON.stringify(will))
        await apiCall('set_config', { values: { [k]: will } })
}

export function err2msg(code: string) {
    return {
        github_quota: "Request denied. You may have reached the limit, retry later.",
        ENOENT: "Not found",
        ENOTDIR: "Not a folder",
    }[code] || HTTP_MESSAGES[code as any] || code
}

export function formatTimestamp(x: number | string | Date) {
    return !x ? '' : (x instanceof Date ? x : new Date(x)).toLocaleString()
}
