import minimist from 'minimist'

export const DEV = process.env.DEV ? 'DEV' : ''

if (DEV)
    console.clear()

const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'front/'
export const API_URI = SPECIAL_URI + 'api/'
export const PLUGINS_PUB_URI = SPECIAL_URI + 'plugins/'

export const argv = minimist(process.argv.slice(2))

export const METHOD_NOT_ALLOWED = 405
export const NO_CONTENT = 204
export const FORBIDDEN = 403
