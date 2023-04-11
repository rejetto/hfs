import { existsSync, writeFileSync } from 'fs'
import events from './events'
import { prefix } from './misc'
import { customHeader } from './frontEndApis'
import { watchLoad } from './watchLoad'
import { proxy } from 'valtio'
import Dict = NodeJS.Dict
import { writeFile } from 'fs/promises'

export const customHtmlSections: ReadonlyArray<string> = ['top', 'bottom', 'beforeHeader', 'afterHeader',
    'afterMenuBar', 'afterEntryName', 'afterList', 'beforeLogin']

export const customHtmlState = proxy<{
    sections: Map<string,string>
}>({
    sections: new Map()
})

const FILE = 'custom.html'

if (!existsSync(FILE))
    events.once('config ready', () => {
        const legacy = prefix('[beforeHeader]\n', customHeader.get())
        writeFileSync(FILE, legacy)
        customHeader.set('') // get rid of it
    })
watchLoad(FILE, data => {
    const re = /^\[(\w+)] *$/gm
    customHtmlState.sections.clear()
    if (!data) return
    let name: string | undefined = 'top'
    do {
        let last = re.lastIndex
        const match = re.exec(data)
        const content = data.slice(last, !match ? undefined : re.lastIndex - (match?.[0]?.length || 0)).trim()
        if (content)
            customHtmlState.sections.set(name, content)
        name = match?.[1]
    } while (name)
})

export function getSection(name: string) {
    return customHtmlState.sections.get(name) || ''
}

export async function saveCustomHtml(sections: Dict<string>) {
    const text = Object.entries(sections).filter(([k,v]) => v?.trim()).map(([k,v]) => `[${k}]\n${v}\n\n`).join('')
    await writeFile(FILE, text)
    customHtmlState.sections.clear()
    for (const [k,v] of Object.entries(sections))
        if (v)
            customHtmlState.sections.set(k, v)
}