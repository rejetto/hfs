// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import minimist from 'minimist'
import * as fs from 'fs'
import { homedir } from 'os'
import _ from 'lodash'
import { basename, dirname, join } from 'path'
import { formatTimestamp } from './cross'
import { argv } from './argv'
export * from './cross-const'

export const API_VERSION = 12.8
export const COMPATIBLE_API_VERSION = 1 // while changes in the api are not breaking, this number stays the same, otherwise it is made equal to API_VERSION

// you can add arguments with this file, currently used for the update process on mac/linux
export const ARGS_FILE = join(homedir(), 'hfs-args')
try {
    const s = fs.readFileSync(ARGS_FILE, 'utf-8')
    console.log('additional arguments', s)
    _.defaults(argv, minimist(JSON.parse(s)))
    fs.unlinkSync(ARGS_FILE)
}
catch {}

export const DEV = process.env.DEV ? 'DEV' : ''
export const ORIGINAL_CWD = process.cwd()
export const HFS_STARTED = new Date()
const PKG_PATH = join(__dirname, '..', 'package.json')
export const BUILD_TIMESTAMP = fs.statSync(PKG_PATH).mtime.toISOString()
const pkg = JSON.parse(fs.readFileSync(PKG_PATH,'utf8'))
export const VERSION = pkg.version
export const RUNNING_BETA = VERSION.includes('-')
export const HFS_REPO_BRANCH = RUNNING_BETA ? VERSION.split('.')[1] : 'main'
export const IS_WINDOWS = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const IS_BINARY = !/node|bun/.test(basename(process.execPath)) // this won't be node if pkg was used
export const APP_PATH = dirname(IS_BINARY ? process.execPath : __dirname) // __dirname's parent can be compared with cwd
export const MIME_AUTO = 'auto'
export const CONFIG_FILE = 'config.yaml'

// we want this to be the first stuff to be printed, then we print it in this module, that is executed at the beginning
if (DEV) {
    console.clear()
    process.env.DEBUG = 'acme-client'
}
else if (!argv.debug) console.debug = ()=>{}
console.log(`HFS ~ HTTP File Server`)
console.log(`© Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt`)
console.log('started', formatTimestamp(HFS_STARTED), DEV)
console.log('version', VERSION||'-')
console.log('build', BUILD_TIMESTAMP||'-')
console.debug('arguments', argv)
// still considering whether to use ".hfs" with Windows users, who may be less accustomed to it
const dir = argv.cwd || useHomeDir() && join(homedir(), '.hfs')
if (dir) {
    try { fs.mkdirSync(dir, { recursive: true }) }
    catch(e: any) {
        if (e.code !== 'EEXIST')
            console.error(e)
    }
    process.chdir(dir)
}
else if (process.cwd().startsWith(process.env.windir + '\\')) // this happens if you run hfs from task scheduler
    process.chdir(APP_PATH)
console.log('working directory (cwd)', process.cwd())
if (APP_PATH !== process.cwd())
    console.log('app', APP_PATH)
console.log('node', process.version)
const bun = (globalThis as any).Bun
if (bun) console.log('bun', bun.version)
console.log('platform', process.platform, process.arch, IS_BINARY ? 'binary' : basename(process.execPath))
console.log('pid', process.pid)

function useHomeDir() {
    if (!IS_WINDOWS || !IS_BINARY) return true
    try { fs.accessSync(CONFIG_FILE, fs.constants.W_OK) }
    catch(e: any) {
        if (e.code !== 'ENOENT')
            return true
        try {
            fs.writeFileSync(CONFIG_FILE, '')  // not found, try to create
            fs.unlinkSync(CONFIG_FILE)
        }
        catch { return true }
    }
}