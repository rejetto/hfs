import { readdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { IS_MAC } from './const'

export async function warnIfUnicodePathError(error: NodeJS.ErrnoException, path: string) {
    if (!IS_MAC || error.code !== 'ENOENT') return
    const name = basename(path)
    if (name.normalize('NFD') === name.normalize('NFC')) return
    // only probe after ENOENT: macOS SMB may compose a name that exists decomposed on the server
    const names = await readdir(dirname(path)).catch(() => [])
    if (names.some(candidate => candidate.normalize('NFC') === name.normalize('NFC')))
        console.warn("File is listed but cannot be accessed, see https://github.com/rejetto/hfs/wiki/Troubleshooting#macos-smb-unicode-filenames-not-working\n", path)
}
