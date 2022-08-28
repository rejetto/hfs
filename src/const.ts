// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import minimist from 'minimist'
import * as fs from 'fs'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { join, resolve } from 'path'

export const argv = minimist(process.argv.slice(2))
export const DEV = process.env.DEV || argv.dev ? 'DEV' : ''
export const ORIGINAL_CWD = process.cwd()
export const HFS_STARTED = new Date()
const PKG_PATH = join(__dirname, '..', 'package.json')
export const BUILD_TIMESTAMP = fs.statSync(PKG_PATH).mtime.toISOString()
const pkg = JSON.parse(fs.readFileSync(PKG_PATH,'utf8'))
export const VERSION = pkg.version
export const DAY = 86_400_000
export const SESSION_DURATION = DAY

export const API_VERSION = 4 // introduced type:real_path and api.subscribeConfig/setConfig/getHfsConfig
export const COMPATIBLE_API_VERSION = 1 // while changes in the api are not breaking, this number stays the same, otherwise is made equal to API_VERSION

export const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'frontend/'
export const ADMIN_URI = SPECIAL_URI + 'admin/'
export const API_URI = SPECIAL_URI + 'api/'
export const PLUGINS_PUB_URI = SPECIAL_URI + 'plugins/'

export const METHOD_NOT_ALLOWED = 405
export const NO_CONTENT = 204
export const FORBIDDEN = 403
export const UNAUTHORIZED = 401

export const IS_WINDOWS = process.platform === 'win32'

export const APP_PATH = resolve(__dirname + '/..')

// we want this to be the first stuff to be printed, then we print it in this module, that is executed at the beginning
if (DEV) console.clear()
else console.debug = ()=>{}
console.log(`HFS ~ HTTP File Server - Copyright 2021-2022, Massimo Melina <a@rejetto.com>`)
console.log(`License https://www.gnu.org/licenses/gpl-3.0.txt`)
console.log('started', HFS_STARTED.toLocaleString(), DEV)
console.log('version', VERSION||'-')
console.log('build', BUILD_TIMESTAMP||'-')
if (argv.cwd)
    process.chdir(argv.cwd)
else if (!process.argv0.endsWith('.exe')) { // still considering whether to use this behavior with Windows users, who may be less accustomed to it
    const dir = join(homedir(), '.hfs')
    try { mkdirSync(dir) }
    catch(e: any) {
        if (e.code !== 'EEXIST')
            console.error(e)
    }
    process.chdir(dir)
}
console.log('cwd', process.cwd())

