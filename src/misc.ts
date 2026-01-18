// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { basename } from 'path'
import Koa from 'koa'
import { Connection } from './connections'
export * from './util-http'
export * from './util-files'
export * from './fileAttr'
export * from './cross'
export * from './debounceAsync'
export * from './AsapStream'
import { Readable, Transform } from 'stream'
import { SocketAddress, BlockList } from 'node:net'
import { ApiError } from './apiMiddleware'
import { HTTP_BAD_REQUEST } from './const'
import { isIpLocalHost, makeMatcher, try_ } from './cross'
import { isIPv6 } from 'net'
import _ from 'lodash'

export function pattern2filter(pattern: string){
    const matcher = makeMatcher(pattern.includes('*') ? pattern  // if you specify *, we'll respect its position
        : pattern.split('|').map(x => `*${x}*`).join('|'))
    return (s: string) =>
        !pattern || matcher(basename(s||''))
}

export function isLocalHost(c: Connection | Koa.Context | string) {
    const ip = typeof c === 'string' ? c : c.ip
    return ip && isIpLocalHost(ip)
}

// this will memory-leak over mask, so be careful with what you use this. Object is 3x faster than _.memoize
export function netMatches(ip: string, mask: string, emptyMaskReturns=false) {
    const cache = (netMatches as any).cache ||= {}
    return (cache[mask + (emptyMaskReturns ? '1' : '0')] ||= makeNetMatcher(mask, emptyMaskReturns))(ip) // cache the matcher
}
export function makeNetMatcher(mask: string, emptyMaskReturns=false) {
    if (!mask)
        return () => emptyMaskReturns
    mask = mask.replaceAll(' ','')
    mask = mask.replace('localhost', '::1|127.0.0.1')
    try {
        if (!/\/|-(?![^\[]*\])/.test(mask)) { // when no CIDR and no ranges are used, then we use standard matcher, otherwise BlockList. For "-" we must skip those inside []
            if (/[^.:\da-fA-F*?|()!]/.test(mask))
                throw mask
            return makeMatcher(mask)
        }
        const all = mask.split('|')
        const neg = all[0]?.[0] === '!'
        if (neg)
            all[0] = all[0]!.slice(1)
        const bl = new BlockList()
        for (const x of all) {
            const m = /^([.:\da-f]+)(?:\/(\d+)|-([.:\da-f]+)|)$/i.exec(x) // parse cidr or range
            if (!m) throw x // we don't support wildcards in this case
            const address = try_(() => parseAddress(m[1]!),
                () => { throw m[1] })
            if (!address) continue
            if (m[2])
                try { bl.addSubnet(address, Number(m[2])) }
                catch { throw x }
            else if (m[3])
                try { bl.addRange(address, parseAddress(m[3]!)) }
                catch { throw m[3] }
            else
                bl.addAddress(address)
        }
        return (ip: string) => {
            try { return neg !== bl.check(parseAddress(ip)) }
            catch {
                console.error("invalid address ", ip)
                return false
            }
        }
    }
    catch(e: any) {
        throw "error in net-mask: " + e
    }
}

// can throw ERR_INVALID_ADDRESS
function parseAddress(s: string) {
    return new SocketAddress({ address: s, family: isIPv6(s) ? 'ipv6' : 'ipv4' })
}

export function same(a: any, b: any) {
    return _.isEqual(a, b)
}

export function asyncGeneratorToReadable<T>(generator: AsyncIterable<T>) {
    const iterator = generator[Symbol.asyncIterator]()
    return new Readable({
        objectMode: true,
        destroy() {
            void iterator.return?.()
        },
        read() {
            iterator.next().then(it => {
                if (it.done)
                    this.emit('ending')
                return this.push(it.done ? null : it.value)
            })
        }
    })
}

export function apiAssertTypes(paramsByType: { [type:string]: { [name:string]: any  } }) {
    for (const [types,params] of Object.entries(paramsByType)) {
        if (!_.isPlainObject(params))
            throw "invalid apiAssertTypes call"
        for (const [name, val] of Object.entries(params))
            if (!types.split('_').some(t => t === 'array' ? Array.isArray(val) : t === 'object' ? _.isPlainObject(val) : typeof val === t))
                throw new ApiError(HTTP_BAD_REQUEST, 'bad ' + name)
    }
}

export function createStreamLimiter(limit: number) {
    let got = 0
    return new Transform({
        transform(chunk, enc, done) {
            const left = limit - got
            got += chunk.length
            if (left > 0) {
                this.push(chunk.length > left ? chunk.slice(0, left) : chunk)
                if (got >= limit)
                    this.end()
            }
            done()
        }
    })
}
