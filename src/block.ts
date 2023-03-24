// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defineConfig } from './config'
import { getConnections, normalizeIp } from './connections'
import { onlyTruthy, with_ } from './misc'
import cidr from 'cidr-tools'
import _ from 'lodash'
import { Socket } from 'net'

type BlockFun = (x: string) => boolean
let blockFunctions: BlockFun[] = [] // "compiled" versions of the rules in config.block

defineConfig<string[]>('block', []).sub(rules => {
    compileBlock(rules)
    for (const { socket, ip } of getConnections())
        applyBlock(socket, ip)
})

function compileBlock(rules: any) {
    blockFunctions = !Array.isArray(rules) ? []
        : onlyTruthy(rules.map(rule => !rule ? null
            : with_(rule.ip, ip => typeof ip !== 'string' ? null
                : ip.includes('/') ? x => cidr.contains(ip, x)
                    : ip.includes('*') ? with_(ipMask2regExp(ip), re => x => re.test(x) )
                        : x => x === ip
            )
        ))

    function ipMask2regExp(ipMask: string) {
        return new RegExp(_.escapeRegExp(ipMask).replace(/\\\*/g, '.*'))
    }
}

export function applyBlock(socket: Socket, ip=normalizeIp(socket.remoteAddress||'')) {
    if (ip && blockFunctions.find(rule => rule(ip)))
        return socket.destroy()
}
