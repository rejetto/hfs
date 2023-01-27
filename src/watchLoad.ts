// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

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
    const debounced = debounceAsync(load, 500, { maxWait: 1000 })
    let retry: NodeJS.Timeout
    let saving: Promise<unknown> | undefined
    let last: string | undefined
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
        try {
            const text = await readFileBusy(path)
            if (text === last)
                return
            last = text
            console.debug('loaded', path)
            const parsed = path.endsWith('.yaml') ? yaml.parse(text) : text
            await parser(parsed)
        }
        catch (e: any) { // ignore read errors
            if (e.code === 'EPERM')
                console.error("missing permissions on file", path) // warn user, who could be clueless about this problem
        }
        finally {
            doing = false
        }
    }
}
