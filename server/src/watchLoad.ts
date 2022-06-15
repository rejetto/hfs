// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { FSWatcher, watch } from 'fs'
import fs from 'fs/promises'
import yaml from 'yaml'
import { debounceAsync, readFileBusy } from './misc'

export type WatchLoadCanceller = () => void

interface Options { failedOnFirstAttempt?: ()=>void }

type WriteFile = typeof fs.writeFile
interface WatchLoadReturn { unwatch:WatchLoadCanceller, save:WriteFile }
export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>, { failedOnFirstAttempt }:Options={}): WatchLoadReturn {
    let doing = false
    let watcher: FSWatcher | undefined
    const debounced = debounceAsync(load, 500, { leading: true })
    let retry: NodeJS.Timeout
    let saving: Promise<unknown> | undefined
    let lastStats: any
    init().then(ok => ok || failedOnFirstAttempt?.())
    return {
        unwatch(){
            watcher?.close()
            clearTimeout(retry)
            watcher = undefined
        },
        save(...args:Parameters<WriteFile>) {
            return Promise.resolve(saving).then(() => // wait in case another is ongoing
                saving = fs.writeFile(...args).finally(() => // save but also keep track of the current operation
                    saving = undefined)) // clear
        }
    }

    async function init() {
        try {
            debounced().then()
            watcher = watch(path, ()=> {
                if (!saving)
                    debounced().then()
            })
            return true // used actually just by the first invocation
        }
        catch(e) {
            retry = setTimeout(init, 3_000) // manual watching until watch is successful
        }
    }

    async function load(){
        if (doing) return
        doing = true
        let data: any
        try {
            try { // I've seen watch() firing 'change' without any change, so we'll check if any change is detectable before going on
                const stats = await fs.stat(path)
                if (stats.mtimeMs === lastStats?.mtimeMs) return
                lastStats = stats

                data = await readFileBusy(path)
                console.debug('loaded', path)
            }
            catch (e: any) {
                if (e.code === 'EPERM')
                    console.error("missing permissions on file", path) // warn user, who could be clueless about this problem
                return // ignore read errors
            }
            if (path.endsWith('.yaml'))
                data = yaml.parse(data)
            await parser(data)
        }
        finally {
            doing = false
        }
    }
}
