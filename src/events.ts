// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

type Listener = (...args: any[]) => unknown
type Listeners = Set<Listener>
const LISTENERS_SUFFIX = '\0listeners'

export class BetterEventEmitter {
    protected listeners = new Map<string, Listeners>()
    stop = Symbol()
    on(event: string | string[], listener: Listener, { warnAfter=10 }={}) {
        if (typeof event === 'string')
            event = [event]
        for (const e of event) {
            let cbs = this.listeners.get(e)
            if (!cbs)
                this.listeners.set(e, cbs = new Set())
            cbs.add(listener)
            if (cbs.size > warnAfter)
                console.warn("Warning: many events listeners for ", e)
            this.emit(e + LISTENERS_SUFFIX, cbs)
        }
        return () => {
            for (const e of event) {
                const cbs = this.listeners.get(e)
                if (!cbs) continue
                cbs.delete(listener)
                this.emit(e + LISTENERS_SUFFIX, cbs)
            }
        }
    }
    // call me when listeners for event have changed
    onListeners(event: string, listener: Listener) {
        return this.on(event + LISTENERS_SUFFIX, listener)
    }
    once(event: string, listener?: Listener) {
        return new Promise<any[]>(resolve => {
            const off = this.on(event, function(...args){
                off()
                resolve(args)
                return listener?.(...arguments)
            })
        })
    }
    multi(map: { [eventName: string]: Listener }) {
        const cbs = Object.entries(map).map(([name, cb]) => this.on(name.split(' '), cb))
        return () => {
            for (const cb of cbs) cb()
        }
    }
    emit(event: string, ...args: any[]) {
        let cbs = this.listeners.get(event)
        if (!cbs?.size) return
        const ret: any[] = []
        for (const cb of cbs) {
            const res = cb(...args)
            if (res !== undefined)
                ret.push(res)
        }
        return Object.assign(ret, {
            isDefaultPrevented: () => ret.some(r => r === this.stop),
        })
    }
    emitAsync(event: string, ...args: any[]) {
        const ret = Promise.all(this.emit(event, ...args) || [])
        return Object.assign(ret, {
            isDefaultPrevented: async () => (await ret).some((r: any) => r === this.stop)
        })
    }
}

// app-wide events
export default new BetterEventEmitter