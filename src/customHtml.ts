import { prefix } from './misc'
import { watchLoad } from './watchLoad'
import { proxy } from 'valtio/vanilla' // without /vanilla we trigger react dependency
import Dict = NodeJS.Dict
import { writeFile } from 'fs/promises'
import { mapPlugins } from './plugins'

export const customHtmlSections: ReadonlyArray<string> = ['beforeHeader', 'afterHeader', 'afterMenuBar', 'afterList',
    'top', 'bottom', 'afterEntryName', 'beforeLogin']

export const customHtmlState = proxy({
    sections: newCustomHtmlState()
})

type CustomHtml = ReturnType<typeof newCustomHtmlState>
export function newCustomHtmlState() {
    return new Map<string, string>()
}

const FILE = 'custom.html'

watchLoadCustomHtml(customHtmlState.sections)

export function watchLoadCustomHtml(state: CustomHtml, folder='') {
    return watchLoad(prefix('', folder, '/') + FILE, data => {
        const re = /^\[(\w+)] *$/gm
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
}

export function getSection(name: string) {
    return (customHtmlState.sections.get(name) || '')
        + mapPlugins(pl => pl.getData().customHtml.get(name)).join('\n')
}

export async function saveCustomHtml(sections: Dict<string>) {
    const text = Object.entries(sections).filter(([k,v]) => v?.trim()).map(([k,v]) => `[${k}]\n${v}\n\n`).join('')
    await writeFile(FILE, text)
    customHtmlState.sections.clear()
    for (const [k,v] of Object.entries(sections))
        if (v)
            customHtmlState.sections.set(k, v)
}