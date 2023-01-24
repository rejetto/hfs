import os from 'os'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { try_ } from './misc'

export function getFreeDiskSync(path: string) {
    if (os.platform() === 'win32') {
        const drive = resolve(path).slice(0, 2).toUpperCase()
        const out = execSync('wmic logicaldisk get FreeSpace,name /format:list').toString().replace(/\r/g, '')
        const one = out.split(/\n\n+/).find(x => x.includes('Name=' + drive))
        if (!one)
            throw Error('miss')
        return Number(/FreeSpace=(\d+)/.exec(one)?.[1])
    }
    const out = try_(() => execSync(`df -k ${path}`).toString(),
        err => {
            throw err.status === 1 ? Error('miss')
                : err.status === 127 ? Error('unsupported')
                    : err
        })
    if (!out?.startsWith('Filesystem'))
        throw Error('unsupported')
    const one = out.split('\n')[1]
    const free = Number(one.split(/\s+/)[3])
    return free * 1024
}