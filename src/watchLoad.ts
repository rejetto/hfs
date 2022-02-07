import { FSWatcher, watch } from 'fs'
import _ from 'lodash'
import yaml from 'yaml'
import { readFileBusy } from './misc'

export type WatchLoadCanceller = () => void

interface Options { failOnFirstAttempt?: ()=>void }

export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>, { failOnFirstAttempt }:Options={}): WatchLoadCanceller {
    let doing = false
    let watcher: FSWatcher
    const debounced = _.debounce(load, 500)
    let initDone = false
    init()
    return () => {
        initDone = true // stop trying
        watcher?.close()
    }

    function init() {
        try {
            debounced()
            watcher = watch(path, debounced)
            initDone = true
        }
        catch {
            if (initDone)
                setTimeout(init, 1000)
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
            if (!initDone)
                failOnFirstAttempt?.()
            doing = false
            console.debug('cannot read', path, String(e))
            return
        }
        await parser(data)
        doing = false
    }
}

