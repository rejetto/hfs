import { FSWatcher, watch } from 'fs'
import _ from 'lodash'
import yaml from 'yaml'
import { readFileBusy } from './misc'

export type WatchLoadCanceller = () => void

interface Options { failOnFirstAttempt?: ()=>void }

export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>, { failOnFirstAttempt }:Options={}): WatchLoadCanceller {
    let doing = false
    let first = true
    let watcher: FSWatcher
    const debounced = _.debounce(load, 500)
    debounced()
    const timer = setInterval(()=>{
        try {
            watcher = watch(path, debounced)
            debounced()
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
        let data: any
        try {
            data = await readFileBusy(path)
            console.debug('loaded', path)
            if (path.endsWith('.yaml'))
                data = yaml.parse(data)
        } catch (e) {
            if (first)
                failOnFirstAttempt?.()
            doing = false
            console.debug('cannot read', path, String(e))
            return
        }
        first = false
        clearInterval(timer)
        await parser(data)
        doing = false
    }
}

