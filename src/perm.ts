import { watch } from 'fs'
import fs from 'fs/promises'
import _ from 'lodash'
import yaml from 'yaml'
import { hashPassword, verifyPassword } from './crypt'
import { argv } from './const'
import { setHidden } from './misc'
import { SESSION_COOKIE } from './apis'
import { sessions } from './sessions'
import Koa from 'koa'

const PATH = argv.accounts || 'accounts.yaml'

interface UserDetails {
    user: string, // we'll have user in it, so we don't need to pass it separately
    password?: string
    hashedPassword: string
}
interface Accounts { [username:string]: UserDetails }

let accounts: Accounts = {}

export async function getCurrentUser(ctx: Koa.Context) {
    const id = ctx.cookies.get(SESSION_COOKIE)
    return id && sessions.get(id)?.user || ''
}

export async function verifyLogin(user:string, password: string) {
    const acc = accounts[user]
    return acc && verifyPassword(acc.hashedPassword, password)
}

let doing = false
load().then()
try { watch(PATH, load) } // find a better way to handle missing file
catch(e){}
async function load() {
    if (doing) return
    doing = true
    try {
        console.debug('loading', PATH)
        let file
        try {
            file = await fs.readFile(PATH, 'utf8')
        }
        catch(e){
            console.warn('cannot read', PATH, e)
            return
        }
        const res = yaml.parse(file)
        // we should validate content here
        if (!res?.accounts)
            return accounts = {}
        accounts = res.accounts
        let changed = false
        await Promise.all(_.map(accounts, async (rec,k) => {
            setHidden(rec, { user: k })
            if (rec.password) {
                rec.hashedPassword = await hashPassword(rec.password)
                delete rec.password
                changed = true
                console.debug('hashing password for', k)
            }
        }))
        if (changed)
            await fs.writeFile(PATH, yaml.stringify(res))
    }
    finally { doing = false }
}
