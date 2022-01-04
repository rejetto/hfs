import fs from 'fs/promises'
import _ from 'lodash'
import yaml from 'yaml'
import { hashPassword, verifyPassword } from './crypt'
import { setHidden, wantArray } from './misc'
import { watchLoad } from './watchLoad'
import Koa from 'koa'
import { subscribeConfig } from './config'

let path = ''

interface Account {
    user: string, // we'll have user in it, so we don't need to pass it separately
    password?: string
    hashedPassword?: string
    belongs?: string[]
}
interface Accounts { [username:string]: Account }

let accounts: Accounts = {}

export async function getCurrentUsername(ctx: Koa.Context) {
    return ctx.session?.user || ''
}

// provides the username and all other usernames it inherits based on the 'belongs' attribute. Useful to check permissions
export async function getCurrentUsernameExpanded(ctx: Koa.Context) {
    const who = await getCurrentUsername(ctx)
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

export function getAccount(username:string) : Account {
    return accounts[username]
}

type Changer = (account:Account)=> void | Promise<void>
export async function updateAccount(username: string, changer:Changer) {
    const account = getAccount(username)
    await changer(account)
    if (account.password) {
        account.hashedPassword = await hashPassword(account.password)
        delete account.password
    }
    saveAccountsAsap()
}

const saveAccountsAsap = _.debounce(() =>
    fs.writeFile(path, yaml.stringify({ accounts })).catch(err =>
        console.error('Failed at saving accounts file, please ensure it is writable.', String(err))))

let watcher: undefined | (()=>void)
subscribeConfig({ k:'accounts', defaultValue:'accounts.yaml' }, v => {
    watcher?.()
    if (!v)
        return applyAccounts({})
    if (typeof v !== 'string')
        return console.error('bad type for accounts')
    watcher = watchLoad(path = v, async data => {
        const a = data?.accounts
        if (!a)
            return console.error('accounts file must contain "accounts" key')
        await applyAccounts(a)
    })
})

async function applyAccounts(newAccounts:Accounts) {
    // we should validate content here
    accounts = newAccounts
    let changed = false
    await Promise.all(_.map(newAccounts, async (rec,k) => {
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
        await saveAccountsAsap()
}
