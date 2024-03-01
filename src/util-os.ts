import { resolve } from 'path'
import { exec, execSync } from 'child_process'
import { onlyTruthy, splitAt, try_ } from './misc'
import _ from 'lodash'
import { pid } from 'node:process'
import { promisify } from 'util'
import { IS_WINDOWS } from './const'

export function getDiskSpaceSync(path: string) {
    if (IS_WINDOWS) {
        const drive = resolve(path).slice(0, 2).toUpperCase()
        const out = execSync('wmic logicaldisk get Size,FreeSpace,Name /format:list').toString().replace(/\r/g, '')
        const one = parseKeyValueObjects(out).find(x => x.Name === drive)
        if (!one)
            throw Error('miss')
        return { free: Number(one.FreeSpace), total: Number(one.Size) }
    }
    const out = try_(() => execSync(`df -k "${path}"`).toString(),
        err => { throw err.status === 1 ? Error('miss') : err.status === 127 ? Error('unsupported') : err })
    if (!out?.startsWith('Filesystem'))
        throw Error('unsupported')
    const one = out.split('\n')[1] as string
    const [used, free] = one.split(/\s+/).slice(2, 4).map(x => Number(x) * 1024) as [number, number]
    return { free, total: used + free }
}

export async function getDiskSpaces(): Promise<{ name: string, free: number, total: number, description?: string }[]> {
    if (IS_WINDOWS) {
        const fields = ['Size','FreeSpace','Name','Description'] as const
        const out = await runCmd(`wmic logicaldisk get ${fields.join()} /format:list`)
        const objs = parseKeyValueObjects<typeof fields[number]>(out)
        return onlyTruthy(objs.map(x => x.Size && {
            total: Number(x.Size),
            free: Number(x.FreeSpace),
            name: x.Name,
            description: x.Description
        }))
    }
    const { stdout } = await promisify(exec)(`df -k`).catch(err => {
        throw err.status === 1 ? Error('miss')
            : err.status === 127 ? Error('unsupported')
                : err
    })
    const out = stdout.split('\n')
    if (!out.shift()?.startsWith('Filesystem'))
        throw Error('unsupported')
    return onlyTruthy(out.map(one => {
        const bits = one.split(/\s+/)
        const name = bits.shift() || ''
        const [, used=0, free=0] = bits.map(x => Number(x) * 1024)
        const total = used + free
        return total && { free, total, name }
    }))
}

export async function getDrives() {
    const stdout = await runCmd('wmic logicaldisk get name')
    return stdout.split('\n').slice(1).map(x => x.trim()).filter(Boolean)
}

// execute win32 shell commands
export async function runCmd(cmd: string, args: string[] = []) {
    const { stdout, stderr } = await promisify(exec)(`@chcp 65001 >nul & cmd /c ${cmd} ${args.join(' ')}`, { encoding: 'utf-8' })
    return (stderr || stdout).replace(/\r/g, '')
}

async function getWindowsServices() {
    const fields = ['PathName', 'DisplayName', 'ProcessId'] as const
    return parseKeyValueObjects<typeof fields[number]>(await runCmd(`wmic service get ${fields.join()} /value`))
}

export const currentServiceName = IS_WINDOWS && new Promise(async resolve =>
    resolve(_.find(await getWindowsServices(), { ProcessId: String(pid) })?.DisplayName))

function parseKeyValueObjects<T extends string>(all: string, keySep='=', lineSep='\n', objectSep=/\n\n+/) {
    return all.split(objectSep).map(obj =>
        Object.fromEntries(obj.split(lineSep).map(kv => splitAt(keySep, kv))) ) as { [k in T]: string }[]
}