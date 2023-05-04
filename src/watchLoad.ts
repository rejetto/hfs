// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { FSWatcher, watch } from 'fs'
import fs from 'fs/promises'
import { debounceAsync, readFileBusy } from './misc'

export type WatchLoadCanceller = () => void

interface Options { failedOnFirstAttempt?: ()=>void, immediateFirst?: boolean }

type WriteFile = typeof fs.writeFile
interface WatchLoadReturn { unwatch:WatchLoadCanceller, save:WriteFile }
export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>, { failedOnFirstAttempt, immediateFirst }:Options={}): WatchLoadReturn {
    let doing = false
    let watcher: FSWatcher | undefined
    const debounced = debounceAsync(load, 500, { maxWait: 1000 })
    let retry: NodeJS.Timeout
    let saving: Promise<unknown> | undefined
    let last: string | undefined
    install(true)
    return {
        unwatch: uninstall,
        save(...args:Parameters<WriteFile>) {
            return Promise.resolve(saving).then(() => // wait in case another is ongoing
                saving = fs.writeFile(...args).finally(() => // save but also keep track of the current operation
                    saving = undefined)) // clear
        }
    }

    function install(first=false) {
        try {
            watcher = watch(path, ()=> {
                if (!saving)
                    debounced().then()
            })
            debounced().catch(x=>x)
            if (immediateFirst)
                debounced.flush().then()
        }
        catch(e) {
            retry = setTimeout(install, 3_000) // manual watching until watch is successful
            if (first)
                failedOnFirstAttempt?.()
        }
    }

    function uninstall() {
        watcher?.close()
        clearTimeout(retry)
        watcher = undefined
    }

    async function load(){
        if (doing) return
        doing = true
        try {
            const text = await readFileBusy(path).catch(e => { // ignore read errors
                if (e.code === 'EPERM')
                    console.error("missing permissions on file", path) // warn user, who could be clueless about this problem
                return ''
            })
            if (text === last)
                return
            last = text
            console.debug('loaded', path)
            uninstall(); install() // reinstall, as the original file could have been renamed. We watch by the name.
            await parser(text)
        }
        finally {
            doing = false
        }
    }
}
