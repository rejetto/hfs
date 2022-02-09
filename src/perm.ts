import fs from 'fs/promises'
import _ from 'lodash'
import yaml from 'yaml'
import { hashPassword } from './crypt'
import { setHidden, wantArray } from './misc'
import { watchLoad } from './watchLoad'
import Koa from 'koa'
import { CFG_ALLOW_CLEAR_TEXT_LOGIN, getConfig, subscribeConfig } from './config'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { vfs, VfsNode } from './vfs'

let path = ''

export interface Account {
    username: string, // we'll have username in it, so we don't need to pass it separately
    password?: string
    hashed_password?: string
    srp?: string
    belongs?: string[]
    ignore_limits?: boolean
    redirect?: string
}
interface Accounts { [username:string]: Account }

let accounts: Accounts = {}

export function getAccounts() {
    return accounts as Readonly<typeof accounts>
}

export function getCurrentUsername(ctx: Koa.Context): string {
    return ctx.session?.username || ''
}

// provides the username and all other usernames it inherits based on the 'belongs' attribute. Useful to check permissions
export function getCurrentUsernameExpanded(ctx: Koa.Context) {
    const who = getCurrentUsername(ctx)
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

export function getAccount(username:string) : Account | undefined {
    return username ? accounts[username] : undefined
}

export function saveSrpInfo(account:Account, salt:string | bigint, verifier: string | bigint) {
    account.srp = String(salt) + '|' + String(verifier)
}

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())

type Changer = (account:Account)=> void | Promise<void>
export async function updateAccount(account: Account, changer?:Changer) {
    const was = JSON.stringify(account)
    await changer?.(account)
    const { username } = account
    if (account.password) {
        console.debug('hashing password for', username)
        if (getConfig(CFG_ALLOW_CLEAR_TEXT_LOGIN))
            account.hashed_password = await hashPassword(account.password)
        const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, account.password)
        saveSrpInfo(account, res.s, res.v)
        delete account.password
    }
    else if (!account.srp && account.hashed_password) {
        console.log('please reset password for account', username)
        process.exit(1)
    }
    account.belongs = wantArray(account.belongs).filter(b =>
        b in accounts // at this stage the group record may still be null if specified later in the file
        || console.error(`account ${username} belongs to non-existing ${b}`) )
    if (was !== JSON.stringify(account))
        saveAccountsAsap()
}

let saving = false
let justSaved = false
const saveAccountsAsap = _.debounce(() => {
    saving = true
    fs.writeFile(path, yaml.stringify({ accounts }, { lineWidth:1000 })) // we don't want big numbers to be folded
        .then(() => justSaved = true,
            err => console.error('Failed at saving accounts file, please ensure it is writable.', String(err)))
        .finally(()=> saving = false)
}, 200) // group burst of requests

let watcher: undefined | (()=>void)
subscribeConfig({ k:'accounts', defaultValue:'accounts.yaml' }, v => {
    watcher?.()
    if (!v)
        return applyAccounts({})
    watcher = watchLoad(path = v, async data => {
        if (justSaved) {
            justSaved = false
            return
        }
        if (saving) return
        const a = data?.accounts
        if (!a)
            return console.error('accounts file must contain "accounts" key')
        console.debug('#accounts', Object.keys(a).length)
        await applyAccounts(a)
    })
})

async function applyAccounts(newAccounts: Accounts) {
    // we should validate content here
    accounts = newAccounts
    await Promise.all(_.map(accounts, async (rec,k) => {
        const lc = k.toLocaleLowerCase()
        if (!rec) // an empty object in yaml is stored as null
            rec = accounts[lc] = { username: lc, srp:'' }
        else if (lc !== k) {
            accounts[lc] = rec
            delete accounts[k]
            k = lc
        }
        setHidden(rec, { username: k })
        await updateAccount(rec)
    }))
}

export function renameAccount(from: string, to: string) {
    if (!to || !accounts[from] || accounts[to])
        return false
    if (to === from)
        return true
    accounts[to] = accounts[from]
    delete accounts[from]
    recur(vfs.root)
    return true

    function recur(n: VfsNode) {
        const p = n.perm
        if (p?.[from]) {
            p[to] = p[from]
            delete p[from]
        }
        if (n.children)
            for (const c of n.children)
                recur(c)
    }
}

const assignableProps = ['redirect','ignore_limits','belongs']

export function addAccount(username: string, props: Partial<Account>) {
    if (!username || accounts[username])
        return
    const copy = { username, ..._.pick(props, assignableProps) }
    setHidden(copy, { username })
    accounts[username] = copy
    return copy
}

export function setAccount(username: string, changes: Partial<Account>) {
    const { username: newU, ...rest } = changes
    if (newU)
        renameAccount(username, newU)
    Object.assign(getAccount(newU || username), _.pick(rest, assignableProps))
    return true
}

export function delAccount(username: string) {
    if (!getAccount(username))
        return false
    delete accounts[username]
    return true
}
