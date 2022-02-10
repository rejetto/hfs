import { FSWatcher, watch } from 'fs'
import yaml from 'yaml'
import { debounceAsync, readFileBusy } from './misc'

export type WatchLoadCanceller = () => void

interface Options { failedOnFirstAttempt?: ()=>void }

export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>, { failedOnFirstAttempt }:Options={}): WatchLoadCanceller {
    let doing = false
    let watcher: FSWatcher | undefined
    const debounced = debounceAsync(load, 500)
    let retry: NodeJS.Timeout
    init()
    if (!watcher)
        failedOnFirstAttempt?.()
    return () => {
        watcher?.close()
        clearTimeout(retry)
    }

    function init() {
        try {
            watcher = watch(path, debounced)
            debounced().then() // if file is not accessible watch will throw and we won't get here
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
            data = await readFileBusy(path)
            console.debug('loaded', path)
            if (path.endsWith('.yaml'))
                data = yaml.parse(data)
        } catch (e) {
            doing = false
            return
        }
        await parser(data)
        doing = false
    }
}

