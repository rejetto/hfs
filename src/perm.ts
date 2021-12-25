import { watch } from 'fs'
import fs from 'fs/promises'
import _ from 'lodash'
import yaml from 'yaml'
import { hashPassword, verifyPassword } from './crypt'
import { argv } from './const'
import { readFileBusy, setHidden, wantArray } from './misc'
import { SESSION_COOKIE } from './apis'
import { sessions } from './sessions'
import Koa from 'koa'

const PATH = argv.accounts || 'accounts.yaml'

interface UserDetails {
    user: string, // we'll have user in it, so we don't need to pass it separately
    password?: string
    hashedPassword?: string
    belongs?: string[]
}
interface Accounts { [username:string]: UserDetails }

let accounts: Accounts = {}

export async function getCurrentUser(ctx: Koa.Context) {
    const id = ctx.cookies.get(SESSION_COOKIE)
    return id && sessions.get(id)?.user || ''
}

export async function getCurrentUserExpanded(ctx: Koa.Context) {
    const who = await getCurrentUser(ctx)
    if (!who)
        return []
    const ret = [who]
    for (const u of ret) {
        const a = getAccount(u)
        if (a?.belongs)
            ret.push(...a.belongs)
    }
    return ret
}

export async function verifyLogin(user:string, password: string) {
    const acc = accounts[user]
    if (!acc) return
    const { hashedPassword: h } = acc
    return h && verifyPassword(h, password)
}

export function getAccount(user:string) : UserDetails {
    return accounts[user]
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
        let res
        try {
            res = yaml.parse(await readFileBusy(PATH))
        }
        catch(e){
            console.warn('cannot read', PATH, e)
            return
        }
        // we should validate content here
        if (!res?.accounts)
            return accounts = {}
        accounts = res.accounts
        let changed = false
        await Promise.all(_.map(accounts, async (rec,k) => {
            if (!rec) // an empty object in yaml is stored as null
                rec = accounts[k] = { user: '' }
            setHidden(rec, { user: k })
            rec.belongs = wantArray(rec.belongs).filter(b =>
                b in accounts // at this stage the group record may still be null if specified later in the file
                || console.error(`user ${k} belongs to non-existing ${b}`) )
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
