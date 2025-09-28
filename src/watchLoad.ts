// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { FSWatcher, watch } from 'fs'
import fs from 'fs/promises'
import { readFileBusy } from './util-files'
import { debounceAsync } from './debounceAsync'
import { BetterEventEmitter } from './events'

export type WatchLoadCanceller = () => void

interface Options { failedOnFirstAttempt?: ()=>void, immediateFirst?: boolean }

type WriteFile = (data: string, options?: { reparse: boolean }) => Promise<void>
interface WatchLoadReturn { unwatch:WatchLoadCanceller, save: WriteFile, emitter: BetterEventEmitter, getText: () => string | undefined, getPath: () => string }
export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>, { failedOnFirstAttempt, immediateFirst }:Options={}): WatchLoadReturn {
    let doing = false
    let watcher: FSWatcher | undefined
    const debounced = debounceAsync(load, { wait: 500, maxWait: 1000 })
    let retry: NodeJS.Timeout
    let last: string | undefined
    const emitter = new BetterEventEmitter()
    install(true)
    const save = debounceAsync(async (data: string, { reparse=false }={}) => {
        await fs.writeFile(path, data, 'utf8')
        last = data
        if (reparse)
            await parser(data)
        emitter.emit('change', last)
    })
    return { unwatch, save, emitter, getText: () => last, getPath: () => path }

    function install(first=false) {
        try {
            watcher = watch(path, () => {
                if (!save.isWorking())
                    void debounced()
            })
            debounced().catch(x=>x)
            if (immediateFirst)
                void debounced.flush()
        }
        catch(e) {
            retry = setTimeout(install, 3_000) // manual watching until watch is successful
            if (first)
                failedOnFirstAttempt?.()
        }
    }

    function unwatch() {
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
            emitter.emit('change', last)
            console.debug('loaded', path)
            unwatch(); install() // reinstall, as the original file could have been renamed. We watch by the name.
            await parser(text)
        }
        finally {
            doing = false
        }
    }
}
