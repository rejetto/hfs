// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import minimist from 'minimist'
import * as fs from 'fs'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'
export * from './cross-const'

export const argv = minimist(process.argv.slice(2))
export const DEV = process.env.DEV || argv.dev ? 'DEV' : ''
export const ORIGINAL_CWD = process.cwd()
export const HFS_STARTED = new Date()
const PKG_PATH = join(__dirname, '..', 'package.json')
export const BUILD_TIMESTAMP = fs.statSync(PKG_PATH).mtime.toISOString()
const pkg = JSON.parse(fs.readFileSync(PKG_PATH,'utf8'))
export const VERSION = pkg.version
export const RUNNING_BETA = VERSION.includes('-')
export const HFS_REPO_BRANCH = RUNNING_BETA ? 'next' : 'main'
export const IS_WINDOWS = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const IS_BINARY = !basename(process.execPath).includes('node') // this won't be node if pkg was used
export const APP_PATH = dirname(IS_BINARY ? process.execPath : __dirname)
export const MIME_AUTO = 'auto'

// we want this to be the first stuff to be printed, then we print it in this module, that is executed at the beginning
if (DEV) console.clear()
else console.debug = ()=>{}
console.log(`HFS ~ HTTP File Server - Copyright 2021-2023, Massimo Melina <a@rejetto.com>`)
console.log(`License https://www.gnu.org/licenses/gpl-3.0.txt`)
console.log('started', HFS_STARTED.toLocaleString(), DEV)
console.log('version', VERSION||'-')
console.log('build', BUILD_TIMESTAMP||'-')
const winExe = IS_WINDOWS && process.execPath.match(/(?<!node)\.exe$/i)
if (argv.cwd)
    process.chdir(argv.cwd)
else if (!winExe) { // still considering whether to use this behavior with Windows users, who may be less accustomed to it
    const dir = join(homedir(), '.hfs')
    try { mkdirSync(dir) }
    catch(e: any) {
        if (e.code !== 'EEXIST')
            console.error(e)
    }
    process.chdir(dir)
}
console.log('cwd', process.cwd())
console.log('node', process.version)
console.log('platform', process.platform)
console.log('pid', process.pid)
