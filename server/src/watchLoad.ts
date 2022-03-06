// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

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
    const debounced = debounceAsync(load, 500)
    let retry: NodeJS.Timeout
    let saving: Promise<unknown> | undefined
    init()
    if (!watcher)
        failedOnFirstAttempt?.()
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

    function init() {
        let triggered = false
        try {
            watcher = watch(path, ()=> {
                triggered = true
                if (!saving)
                    debounced().then()
            })
            if (!triggered)
                debounced().then() // if file is not accessible watch will throw, and we won't get here
        }
        catch {
            retry = setTimeout(init, 1000) // manual watching until watch is successful
        }
    }

    async function load(){
        if (doing) return
        doing = true
        let data: any
        try {
            try {
                data = await readFileBusy(path)
                console.debug('loaded', path)
            }
            catch (e) { return } // silently ignore read errors
            if (path.endsWith('.yaml'))
                data = yaml.parse(data)
            await parser(data)
        }
        finally {
            doing = false
        }
    }
}
