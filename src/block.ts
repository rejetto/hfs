// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defineConfig } from './config'
import { disconnect, getConnections, normalizeIp } from './connections'
import { makeNetMatcher, MINUTE, onlyTruthy } from './misc'
import { Socket } from 'net'
import _ from 'lodash'

export interface BlockingRule { ip: string, comment?: string, expire?: Date, disabled?: boolean }

export const block = defineConfig('block', [] as BlockingRule[], rules => {
    const now = new Date()
    const ret = !Array.isArray(rules) ? []
        : onlyTruthy(rules.map(rule => {
            rule.expire &&= new Date(rule.expire)
            return !rule.disabled && (rule.expire || now) >= now && makeNetMatcher(rule.ip)
        }))
    // reapply new block to existing connections
    for (const { socket, ip } of getConnections())
        applyBlock(socket, ip)
    return ret
})

export function applyBlock(socket: Socket, ip=normalizeIp(socket.remoteAddress||'')) {
    if (ip && block.compiled().find(rule => rule(ip)))
        return disconnect(socket, 'block-ip')
}

setInterval(() => { // twice a minute, check if any block has expired
    const now = new Date()
    const next = block.get().filter(x => !x.expire || x.expire > now)
    const n = block.get().length - next.length
    if (!n) return
    console.log("blocking rules:", n, "expired")
    block.set(next)
}, MINUTE/2)

export function addBlock(rule: BlockingRule, merge?: Partial<BlockingRule>) {
    block.set(was => {
        const foundIdx = merge ? _.findIndex(was, merge) : -1
        return foundIdx < 0 ? [...was, { ...merge, ...rule }]
            : was.map((x, i) => i === foundIdx ? { ...x, ...rule, ip: `${x.ip}|${rule.ip}` } : x)
    })
}