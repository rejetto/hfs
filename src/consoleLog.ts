import events from './events'
import { formatTime, formatTimestamp } from './cross'
import { createWriteStream } from 'fs'
import { argv } from './argv'

export const consoleLog: Array<{ ts: Date, k: string, msg: string }> = []
const f = argv.consoleFile ? createWriteStream(argv.consoleFile, 'utf-8') : null
for (const k of ['log','warn','error']) {
    const original = console[k as 'log']
    console[k as 'log'] = (...args: any[]) => {
        const ts = new Date()
        const msg = safeJoin(args) // if args contains a symbol, join will throw
        const rec = { ts, k, msg }
        consoleLog.push(rec)
        if (consoleLog.length > 100_000) // limit to avoid infinite space
            consoleLog.splice(0, 1_000)
        events.emit('console', rec)
        f?.write(`${formatTimestamp(ts)} [${k}] ${msg}\n`)
        if (k !== 'log')
            args.unshift('!')
        return original(formatTime(ts), ...args) // bundled nodejs doesn't have locales (and apparently uses en-US)
    }
}

function safeJoin(a: unknown[]): string {
    try { return a.join(' ') }
    catch {
        return a.map(x => {
            if (x == null)
                return ''
            try { return String(x) }
            catch {
                if (Array.isArray(x))
                    return `[${safeJoin(x)}]`
                try { return JSON.stringify(x) }
                catch { return 'N/A' }
            }
        }).join(' ')
    }
}

export function consoleHint(msg: string) {
    console.log("HINT: "+ msg)
}