// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defineConfig } from './config'
import { getConnections, normalizeIp } from './connections'
import { makeNetMatcher, onlyTruthy } from './misc'
import { Socket } from 'net'

type BlockFun = (x: string) => boolean
let blockFunctions: BlockFun[] = [] // "compiled" versions of the rules in config.block

defineConfig<string[]>('block', []).sub(rules => {
    blockFunctions = !Array.isArray(rules) ? []
        : onlyTruthy(rules.map((rule: any) => rule?.ip && makeNetMatcher(rule.ip)))
    // reapply new block to existing connections
    for (const { socket, ip } of getConnections())
        applyBlock(socket, ip)
})

export function applyBlock(socket: Socket, ip=normalizeIp(socket.remoteAddress||'')) {
    if (ip && blockFunctions.find(rule => rule(ip)))
        return socket.destroy()
}
