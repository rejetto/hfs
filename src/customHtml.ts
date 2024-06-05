import { prefix } from './misc'
import { watchLoad } from './watchLoad'
import { proxy } from 'valtio/vanilla' // without /vanilla we trigger react dependency
import Dict = NodeJS.Dict
import { writeFile } from 'fs/promises'
import { mapPlugins } from './plugins'
import _ from 'lodash'

const FILE = 'custom.html'

export const customHtmlSections: ReadonlyArray<string> = ['style', 'beforeHeader', 'afterHeader', 'afterMenuBar', 'afterList',
    'top', 'bottom', 'afterEntryName', 'beforeLogin', 'unauthorized', 'htmlHead']

export const customHtmlState = proxy({
    sections: watchLoadCustomHtml().state
})

export function watchLoadCustomHtml(folder='') {
    const state = new Map<string, string>()
    const res = watchLoad(prefix('', folder, '/') + FILE, data => {
        const re = /^\[([^\]]+)] *$/gm
        state.clear()
        if (!data) return
        let name: string | undefined = 'top'
        do {
            let last = re.lastIndex
            const match = re.exec(data)
            const content = data.slice(last, !match ? undefined : re.lastIndex - (match?.[0]?.length || 0)).trim()
            if (content)
                state.set(name, content)
            name = match?.[1]
        } while (name)
    })
    return Object.assign(res, { state })
}

export function getSection(name: string) {
    return (customHtmlState.sections.get(name) || '')
        + mapPlugins(pl => pl.getData().customHtml?.()[name]).join('\n')
}

export function getAllSections() {
    const keys = mapPlugins(pl => Object.keys(pl.getData().customHtml?.()))
    keys.push(Array.from(customHtmlState.sections.keys()))
    const all = _.uniq(keys.flat())
    return Object.fromEntries(all.map(x => [x, getSection(x)]))
}

export async function saveCustomHtml(sections: Dict<string>) {
    const text = Object.entries(sections).filter(([k,v]) => v?.trim()).map(([k,v]) => `[${k}]\n${v}\n\n`).join('')
    await writeFile(FILE, text)
    customHtmlState.sections.clear()
    for (const [k,v] of Object.entries(sections))
        if (v)
            customHtmlState.sections.set(k, v)
}