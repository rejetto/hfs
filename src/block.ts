// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defineConfig } from './config'
import { getConnections, normalizeIp } from './connections'
import { makeNetMatcher, onlyTruthy } from './misc'
import { Socket } from 'net'

interface BlockingRule { ip: string }

const block = defineConfig('block', [] as BlockingRule[], rules => {
    const ret = !Array.isArray(rules) ? []
        : onlyTruthy(rules.map(rule => makeNetMatcher(rule.ip, true)))
    // reapply new block to existing connections
    for (const { socket, ip } of getConnections())
        applyBlock(socket, ip)
    return ret
})

export function applyBlock(socket: Socket, ip=normalizeIp(socket.remoteAddress||'')) {
    if (ip && block.compiled().find(rule => rule(ip)))
        return socket.destroy()
}
