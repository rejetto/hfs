import events from './events'

export const consoleLog: Array<{ ts: Date, k: string, msg: string }> = []
for (const k of ['log','warn','error']) {
    const original = console[k as 'log']
    console[k as 'log'] = (...args: any[]) => {
        const ts = new Date()
        const rec = { ts, k, msg: args.join(' ') }
        consoleLog.push(rec)
        if (consoleLog.length > 100_000) // limit to avoid infinite space
            consoleLog.splice(0, 1_000)
        events.emit('console', rec)
        return original(ts.toLocaleTimeString(undefined, { hourCycle: 'h24' }), ...args) // bundled nodejs doesn't have locales (and apparently uses en-US)
    }
}
