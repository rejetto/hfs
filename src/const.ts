import minimist from 'minimist'

export const DEV = process.env.NODE_ENV === 'development' ? 'DEV' : ''

if (DEV)
    console.clear()

const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'front/'
export const API_URI = SPECIAL_URI + 'api/'

export const argv = minimist(process.argv.slice(2))
