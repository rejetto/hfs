import _ from 'lodash'
import { splitAt } from './cross'

export const SERVER_CODE_SPLIT = '//---'
export function parseServerCode(text: string) {
    const split = text.split(new RegExp('(?:^|\n)' + _.escapeRegExp(SERVER_CODE_SPLIT), 'g'))
    const ret: { name: string, code: string }[] = []
    let first = true
    for (const part of split)
        if (first) { // first is special, no name
            first = false
            const code = part.trim()
            if (code)
                ret.push({ name: '', code })
        }
        else {
            const [name, code] = splitAt('\n', part)
            ret.push({ name, code })
        }
    return ret
}

