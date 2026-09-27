import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import fswin from 'fswin'

export async function detectNetworkPaths(paths: string[]): Promise<string[]> {
    if (!paths.length) return []
    if (process.platform === 'win32') {
        const drives = await new Promise<fswin.LogicalDriveList>(resolve => {
            if (!fswin.getLogicalDriveList(list => resolve(list || {})))
                resolve({})
        })
        return paths.filter(path => /^\\\\[^?.\\][^\\]*\\/.test(path) || path.startsWith('\\\\?\\UNC\\')
            || Object.entries(drives).some(([letter, type]) => type === 'REMOTE'
                && letter[0]?.toUpperCase() === path[0]?.toUpperCase()))
    }
    const mounts: { path: string, network: boolean }[] = []
    // read local mount metadata instead of probing potentially unreachable remote filesystems
    if (process.platform === 'linux') {
        const text = await readFile('/proc/self/mountinfo', 'utf8')
        for (const line of text.split('\n')) {
            const [fields, filesystem] = line.split(' - ')
            const path = fields?.split(' ')[4]
            if (path && filesystem)
                mounts.push({ path: unescapePath(path), network: isNetworkType(filesystem.split(' ')[0]!) })
        }
    }
    else if (process.platform === 'darwin') {
        const { stdout } = await promisify(execFile)('/sbin/mount', [], { timeout: 2000 })
        for (const line of stdout.split('\n')) {
            const match = / on (.+) \(([^,)]+)/.exec(line)
            if (match)
                mounts.push({ path: unescapePath(match[1]!), network: isNetworkType(match[2]!) })
        }
    }
    mounts.sort((a, b) => b.path.length - a.path.length)
    return paths.filter(path => mounts.find(mount => contains(mount.path, path))?.network
        || mounts.some(mount => mount.network && contains(path, mount.path)))

    function isNetworkType(type: string) {
        return ['nfs', 'nfs4', 'cifs', 'smbfs', 'smb3', 'fuse.sshfs'].includes(type)
    }

    function unescapePath(path: string) {
        return path.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    }

    function contains(parent: string, child: string) {
        const path = relative(resolve(parent), resolve(child))
        return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
    }
}
