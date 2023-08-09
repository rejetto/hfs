import events from './events'

export const consoleLog: Array<{ ts: Date, k: string, msg: string }> = []
for (const k of ['log','warn','error']) {
    const original = console[k as 'log']
    console[k as 'log'] = (...args: any[]) => {
        const rec = { ts: new Date(), k, msg: args.join(' ') }
        consoleLog.push(rec)
        events.emit('console', rec)
        return original(...args)
    }
}
