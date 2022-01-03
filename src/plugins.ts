import { watch } from 'fs'
import glob from 'fast-glob'
import { watchLoad } from './misc'
import _ from 'lodash'

export const PATH = 'plugins'

try {
    const debounced = _.debounce(rescan, 1000)
    watch(PATH, debounced)
    debounced()
}
catch(e){
    console.debug('plugins not found')
}

interface Plugin {
    data: any
    unwatch: ()=>void
}
export const plugins: Record<string, Plugin> = {}

async function rescan() {
    console.debug('scanning plugins')
    const found = []
    for (const f of await glob(PATH+'/*/plugin.yaml')) {
        const k = f.split('/').slice(-2)[0]
        if (k.endsWith('-disabled')) continue
        found.push(k)
        if (plugins[k]) // already loaded
            continue
        const unwatch = watchLoad(f, data => {
            console.log('loading plugin', k)
            plugins[k] = { data, unwatch }
        })
    }
    for (const k in plugins)
        if (!found.includes(k))
            unloadPlugin(k)
}

function unloadPlugin(k: string) {
    console.log('unloading plugin', k)
    plugins[k]?.unwatch()
    delete plugins[k]
}
