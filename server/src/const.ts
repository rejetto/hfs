// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import minimist from 'minimist'
import * as fs from 'fs'
import _ from 'lodash'

export const DEV = process.env.DEV ? 'DEV' : ''
export const HFS_STARTED = new Date()
export const BUILD_TIMESTAMP = ''
export const VERSION = ''
    || DEV && String(_.attempt(() => JSON.parse(fs.readFileSync('package.json','utf8')).version)) // this should happen only in dev, build fills this value
export const SESSION_DURATION = 30*60_000
export const DAY = 86_400_000

export const API_VERSION = 3 // introduced config.defaultValue and async for init/unload
export const COMPATIBLE_API_VERSION = 1 // while changes in the api are not breaking, this number stays the same, otherwise is made equal to API_VERSION

export const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'frontend/'
export const ADMIN_URI = SPECIAL_URI + 'admin/'
export const API_URI = SPECIAL_URI + 'api/'
export const PLUGINS_PUB_URI = SPECIAL_URI + 'plugins/'

export const argv = minimist(process.argv.slice(2))

export const METHOD_NOT_ALLOWED = 405
export const NO_CONTENT = 204
export const FORBIDDEN = 403

export const IS_WINDOWS = process.platform === 'win32'

// we want this to be the first stuff to be printed, then we print it in this module, that is executed at the beginning
if (DEV) console.clear()
else console.debug = ()=>{}
console.log(`HFS ~ HTTP File Server - Copyright 2021-2022, Massimo Melina <a@rejetto.com>`)
console.log(`License https://www.gnu.org/licenses/gpl-3.0.txt`)
console.log('started', HFS_STARTED.toLocaleString(), DEV)
console.log('version', VERSION||'-')
console.log('build', BUILD_TIMESTAMP||'-')
console.log('cwd', process.cwd())

