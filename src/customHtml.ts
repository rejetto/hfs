import { existsSync, writeFileSync } from 'fs'
import events from './events'
import { prefix } from './misc'
import { customHeader } from './frontEndApis'
import { watchLoad } from './watchLoad'
import { proxy } from 'valtio'

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
        customHeader.set(undefined) // get rid of it
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

