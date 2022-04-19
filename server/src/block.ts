import { subscribeConfig } from './config'
import { getConnections } from './connections'
import { onlyTruthy, with_ } from './misc'
import cidr from 'cidr-tools'
import _ from 'lodash'
import { Socket } from 'net'

subscribeConfig({ k: 'block', defaultValue: [] }, (rules: any) => {
    compileBlock(rules)
    for (const { socket } of getConnections())
        applyBlock(socket)
})

type BlockFun = (x: string) => boolean
let blockFunctions: BlockFun[] = [] // "compiled" versions of the rules in config.block

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

export function applyBlock(socket: Socket) {
    const ip = socket.remoteAddress
    if (ip && blockFunctions.find(rule => rule(ip)))
        return socket.destroy()
}
