import { FSWatcher, watch } from 'fs'
import _ from 'lodash'
import yaml from 'yaml'
import { readFileBusy } from './misc'

export type WatchLoadCanceller = () => void

export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>): WatchLoadCanceller {
    let doing = false
    let watcher: FSWatcher
    const debounced = _.debounce(load, 100)
    const timer = setInterval(()=>{
        try {
            watcher = watch(path, debounced)
            debounced()
            clearInterval(timer)
        }
        catch(e){
        }
    }, 1000)
    let running = true
    return () => {
        if (!running) return
        running = false
        clearInterval(timer)
        watcher?.close()
    }

    async function load(){
        if (doing) return
        doing = true
        console.debug('loading', path)
        let data: any
        try {
            data = await readFileBusy(path)
            if (path.endsWith('.yaml'))
                data = yaml.parse(data)
        } catch (e) {
            doing = false
            console.warn('cannot read', path, String(e))
            return
        }
        await parser(data)
        doing = false
    }
}

