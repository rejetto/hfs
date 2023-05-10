// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import minimist from 'minimist'
import * as fs from 'fs'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'

export const argv = minimist(process.argv.slice(2))
export const DEV = process.env.DEV || argv.dev ? 'DEV' : ''
export const ORIGINAL_CWD = process.cwd()
export const HFS_STARTED = new Date()
const PKG_PATH = join(__dirname, '..', 'package.json')
export const BUILD_TIMESTAMP = fs.statSync(PKG_PATH).mtime.toISOString()
const pkg = JSON.parse(fs.readFileSync(PKG_PATH,'utf8'))
export const VERSION = pkg.version
export const DAY = 86_400_000

export const API_VERSION = 8.1 // entry.uri + script.plugin + absolute frontend_*
export const COMPATIBLE_API_VERSION = 1 // while changes in the api are not breaking, this number stays the same, otherwise it is made equal to API_VERSION

export const HFS_REPO = 'rejetto/hfs'

export const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'frontend/'
export const ADMIN_URI = SPECIAL_URI + 'admin/'
export const API_URI = SPECIAL_URI + 'api/'
export const PLUGINS_PUB_URI = SPECIAL_URI + 'plugins/'

export const HTTP_OK = 200
export const HTTP_NO_CONTENT = 204
export const HTTP_PARTIAL_CONTENT = 206
export const HTTP_TEMPORARY_REDIRECT = 302
export const HTTP_NOT_MODIFIED = 304
export const HTTP_BAD_REQUEST = 400
export const HTTP_UNAUTHORIZED = 401
export const HTTP_FORBIDDEN = 403
export const HTTP_NOT_FOUND = 404
export const HTTP_METHOD_NOT_ALLOWED = 405
export const HTTP_NOT_ACCEPTABLE = 406
export const HTTP_CONFLICT = 409
export const HTTP_PAYLOAD_TOO_LARGE = 413
export const HTTP_RANGE_NOT_SATISFIABLE = 416
export const HTTP_FOOL = 418
export const HTTP_SERVER_ERROR = 500

export const IS_WINDOWS = process.platform === 'win32'
export const IS_BINARY = !basename(process.execPath).includes('node') // this won't be node if pkg was used
export const APP_PATH = dirname(IS_BINARY ? process.execPath : __dirname)

// we want this to be the first stuff to be printed, then we print it in this module, that is executed at the beginning
if (DEV) console.clear()
else console.debug = ()=>{}
console.log(`HFS ~ HTTP File Server - Copyright 2021-2023, Massimo Melina <a@rejetto.com>`)
console.log(`License https://www.gnu.org/licenses/gpl-3.0.txt`)
console.log('started', HFS_STARTED.toLocaleString(), DEV)
console.log('version', VERSION||'-')
console.log('build', BUILD_TIMESTAMP||'-')
console.log('pid', process.pid)
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