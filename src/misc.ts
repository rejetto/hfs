// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { EventEmitter } from 'events'
import { basename } from 'path'
import _ from 'lodash'
import Koa from 'koa'
import { Connection } from './connections'
import assert from 'assert'
export * from './util-http'
export * from './util-files'
export * from './cross'
export * from './debounceAsync'
import { Readable } from 'stream'
import { matcher } from 'micromatch'
import { SocketAddress, BlockList } from 'node:net'
import { ApiError } from './apiMiddleware'
import { HTTP_BAD_REQUEST } from './const'
import { ipLocalHost } from './cross'
import { isIPv6 } from 'net'

type ProcessExitHandler = (signal:string) => any
const cbs = new Set<ProcessExitHandler>()
export function onProcessExit(cb: ProcessExitHandler) {
    cbs.add(cb)
    return () => cbs.delete(cb)
}
onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT', 'SIGHUP'], signal =>
    Promise.allSettled(Array.from(cbs).map(cb => cb(signal))).then(() =>
        process.exit(0)))

export function onFirstEvent(emitter:EventEmitter, events: string[], cb: (...args:any[])=> void) {
    let already = false
    for (const e of events)
        emitter.once(e, (...args) => {
            if (already) return
            already = true
            cb(...args)
        })
}

export function pattern2filter(pattern: string){
    const re = new RegExp(_.escapeRegExp(pattern), 'i')
    return (s?:string) =>
        !s || !pattern || re.test(basename(s))
}

// install multiple handlers and returns a handy 'uninstall' function which requires no parameter. Pass a map {event:handler}
export function onOff(em: EventEmitter, events: { [eventName:string]: (...args: any[]) => void }) {
    events = { ...events } // avoid later modifications, as we need this later for uninstallation
    for (const [k,cb] of Object.entries(events))
        for (const e of k.split(' '))
            em.on(e, cb)
    return () => {
        for (const [k,cb] of Object.entries(events))
            for (const e of k.split(' '))
                em.off(e, cb)
    }
}

export function isLocalHost(c: Connection | Koa.Context | string) {
    const ip = typeof c === 'string' ? c : c.socket.remoteAddress // don't use Context.ip as it is subject to proxied ips, and that's no use for localhost detection
    return ip && ipLocalHost(ip)
}

export function makeNetMatcher(mask: string, emptyMaskReturns=false) {
    if (!mask)
        return () => emptyMaskReturns
    if (!mask.includes('/'))
        return makeMatcher(mask)
    const all = mask.split('|')
    const neg = all[0]?.[0] === '!'
    if (neg)
        all[0] = all[0]!.slice(1)
    const bl = new BlockList()
    for (const x of all) {
        const m = /^([.:\da-f]+)(?:\/(\d+)|-(.+)|)$/i.exec(x)
        if (!m) {
            console.warn("error in network mask", x)
            continue
        }
        const address = parseAddress(m[1]!)
        if (m[2])
            bl.addSubnet(address, Number(m[2]))
        else if (m[3])
            bl.addRange(address, parseAddress(m[2]!))
        else
            bl.addAddress(address)
    }
    return (ip: string) => neg !== bl.check(ip)
}

function parseAddress(s: string) {
    return new SocketAddress({ address: s, family: isIPv6(s) ? 'ipv6' : 'ipv4' })
}

export function makeMatcher(mask: string, emptyMaskReturns=false) {
    return mask ? matcher(mask.replace(/^(!)?/, '$1(') + ')', { nocase: true}) // adding () will allow us to use the pipe at root level
        : () => emptyMaskReturns
}

export function matches(s: string, mask: string, emptyMaskReturns=false) {
    return makeMatcher(mask, emptyMaskReturns)(s) // adding () will allow us to use the pipe at root level
}

export function same(a: any, b: any) {
    try {
        assert.deepStrictEqual(a, b)
        return true
    }
    catch { return false }
}

export function asyncGeneratorToReadable<T>(generator: AsyncIterable<T>) {
    const iterator = generator[Symbol.asyncIterator]()
    return new Readable({
        objectMode: true,
        read() {
            iterator.next().then(it =>
                this.push(it.done ? null : it.value))
        }
    })
}

// produces as promises resolve, not sequentially
export class AsapStream<T> extends Readable {
    finished = false
    constructor(private promises: Promise<T>[]) {
        super({ objectMode: true })
    }
    _read() {
        if (this.finished) return
        this.finished = true
        for (const p of this.promises)
            p.then(data => this.push(data), e => this.emit('error', e))
        Promise.allSettled(this.promises).then(() => this.push(null))
    }
}

export function apiAssertTypes(paramsByType: { [type:string]: { [name:string]: any  } }) {
    for (const [types,params] of Object.entries(paramsByType))
        for (const type of types.split('_'))
            for (const [name,val] of Object.entries(params))
                if (type === 'array' ? !Array.isArray(val) : typeof val !== type)
                    throw new ApiError(HTTP_BAD_REQUEST, 'bad ' + name)
}