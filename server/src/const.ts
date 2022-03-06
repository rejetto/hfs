// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import minimist from 'minimist'
import * as fs from 'fs'
import _ from 'lodash'

export const DEV = process.env.DEV ? 'DEV' : ''
export const HFS_STARTED = new Date()
export const BUILD_TIMESTAMP = ''
export const VERSION = ''
    || DEV && String(_.attempt(() => JSON.parse(fs.readFileSync('package.json','utf8')).version)) // this should happen only in dev, build fills this value
export const SESSION_DURATION = 30*60_000

export const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'frontend/'
export const API_URI = SPECIAL_URI + 'api/'
export const PLUGINS_PUB_URI = SPECIAL_URI + 'plugins/'

export const argv = minimist(process.argv.slice(2))

export const METHOD_NOT_ALLOWED = 405
export const NO_CONTENT = 204
export const FORBIDDEN = 403

export const IS_WINDOWS = process.platform === 'win32'

