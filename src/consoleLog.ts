import events from './events'
import { formatTime, formatTimestamp } from './cross'
import { createWriteStream } from 'fs'
import { argv } from './argv'

export const consoleLog: Array<{ ts: Date, k: string, msg: string }> = []
const originalConsoleLog = console.log
let f = argv.consoleFile ? createWriteStream(argv.consoleFile, { flags: 'a', encoding: 'utf8' }) : null
f?.on('error', err => {
    f = null // stop using a failed stream so later logs cannot repeat the same error
    console.error("Cannot write console file", argv.consoleFile, String(err))
})
let terminalOutputBroken = false
for (const stream of [process.stdout, process.stderr])
    stream.on('error', err => {
        if (!isBrokenTerminalOutput(err))
            throw err
        // after the terminal/pipe is gone, further console writes would just re-emit the same process-level error
        terminalOutputBroken = true
    })
for (const k of ['log','warn','error','debug'] as const) {
    const original = console[k]
    console[k as 'log'] = (...args: any[]) => {
        const ts = new Date()
        if (k === 'debug')
            args.unshift('DBG')
        else {
            const msg = safeJoin(args) // if args contains a symbol, join will throw
            const rec = { ts, k, msg }
            consoleLog.push(rec)
            if (consoleLog.length > 100_000) // limit to avoid infinite space
                consoleLog.splice(0, 1_000)
            events.emit('console', rec)
            f?.write(`${formatTimestamp(ts)} [${k}] ${msg}\n`)
            if (k !== 'log')
                args.unshift('!')
        }
        if (!terminalOutputBroken) {
            try { return original(formatTime(ts), ...args) } // bundled nodejs doesn't have locales (and apparently uses en-US)
            catch (err) {
                if (!isBrokenTerminalOutput(err))
                    throw err
                terminalOutputBroken = true
            }
        }
    }
    Object.assign(console[k], { original })
}

const over = console.log
for (const k of ['table'] as const) {
    const original = console[k]
    console[k] = (...args: any[]) => {
        console.log = originalConsoleLog
        // @ts-ignore
        try { return original(...args) }
        finally { console.log = over }
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

function isBrokenTerminalOutput(err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    return code === 'EPIPE' || code === 'EIO'
        || code === 'ERR_STREAM_DESTROYED' || code === 'ERR_STREAM_WRITE_AFTER_END'
}

export function consoleHint(msg: string) {
    console.log("HINT: "+ msg)
}
