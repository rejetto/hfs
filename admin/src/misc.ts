// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall } from './api'
export * from './mui'
export * from '@hfs/shared'

export async function manipulateConfig(k: string, work:(data:any) => any) {
    const cfg = await apiCall('get_config', { only: [k] })
    const was = cfg[k]
    const will = await work(was)
    if (JSON.stringify(was) !== JSON.stringify(will))
        await apiCall('set_config', { values: { [k]: will } })
}

export function err2msg(code: string) {
    return {
        ENOENT: "Not found",
        ENOTDIR: "Not a folder",
    }[code] || code
}
