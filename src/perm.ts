// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { hashPassword } from './crypt'
import { objRenameKey, setHidden, wantArray } from './misc'
import Koa from 'koa'
import { defineConfig, saveConfigAsap } from './config'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import events from './events'

export interface Account {
    username: string, // we keep username property (hidden) so we don't need to pass it separately
    password?: string
    hashed_password?: string
    srp?: string
    belongs?: string[]
    ignore_limits?: boolean
    disable_password_change?: boolean
    admin?: boolean
    redirect?: string
    disabled?: boolean
}
interface Accounts { [username:string]: Account }

let accounts: Accounts = {}

// provides the username and all other usernames it inherits based on the 'belongs' attribute. Useful to check permissions
export function expandUsername(who: string): string[] {
    const ret = []
    const q = [who]
    for (const u of q) {
        const a = getAccount(u)
        if (!a || a.disabled) continue
        ret.push(u)
        if (a.belongs)
            q.push(...a.belongs)
    }
    return ret
}

export function getAccount(username:string, normalize=true) : Account | undefined {
    if (normalize)
        username = normalizeUsername(username)
    return username ? accounts[username] : undefined
}

export function saveSrpInfo(account:Account, salt:string | bigint, verifier: string | bigint) {
    account.srp = String(salt) + '|' + String(verifier)
}

export const allowClearTextLogin = defineConfig('allow_clear_text_login', false)

const createAdminConfig = defineConfig('create-admin', '')
createAdminConfig.sub(v => {
    if (!v) return
    createAdmin(v)
    createAdminConfig.set('')
})

export function createAdmin(pass: string, username='admin') {
    const acc = addAccount(username, { admin: true })
    if (!acc) return console.log("cannot create, already exists")
    updateAccount(acc!, acc => { acc.password = pass })
    console.log("account admin created")
}

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())

type Changer = (account:Account)=> void | Promise<void>
export async function updateAccount(account: Account, changer?:Changer) {
    const was = JSON.stringify(account)
    await changer?.(account)
    const { username } = account
    if (account.password) {
        console.debug('hashing password for', username)
        if (allowClearTextLogin.get())
            account.hashed_password = await hashPassword(account.password)
        const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, account.password)
        saveSrpInfo(account, res.s, res.v)
        delete account.password
    }
    else if (!account.srp && account.hashed_password) {
        console.log('please reset password for account', username)
        process.exit(1)
    }
    if (account.belongs) {
        account.belongs = wantArray(account.belongs)
        _.remove(account.belongs, b => {
            if (accounts.hasOwnProperty(b)) return
            console.error(`account ${username} belongs to non-existing ${b}`)
            return true
        })
    }
    if (was !== JSON.stringify(account))
        saveAccountsAsap()
}

const saveAccountsAsap = saveConfigAsap

export const accountsConfig = defineConfig('accounts', {} as Accounts)
accountsConfig.sub(obj => {
    // consider some validation here
    _.each(accounts = obj, (rec,k) => {
        const norm = normalizeUsername(k)
        if (rec?.username !== norm) {
            if (!rec) // an empty object in yaml is parsed as null
                rec = obj[norm] = { username: norm }
            else if (objRenameKey(obj, k, norm))
                saveAccountsAsap()
            setHidden(rec, { username: norm })
        }
        updateAccount(rec).then() // work password fields
    })
})

export function normalizeUsername(username: string) {
    return username.toLocaleLowerCase()
}

export function renameAccount(from: string, to: string) {
    from = normalizeUsername(from)
    to = normalizeUsername(to)
    if (!to || !accounts[from] || accounts[to])
        return false
    if (to === from)
        return true
    objRenameKey(accounts, from, to)
    updateReferences()
    saveAccountsAsap()
    return true

    function updateReferences() {
        setHidden(accounts[to], { username: to })
        for (const a of Object.values(accounts)) {
            const idx = a.belongs?.indexOf(from)
            if (idx !== undefined && idx >= 0)
                a.belongs![idx] = to
        }
        events.emit('accountRenamed', from, to) // everybody, take care of your stuff
    }
}

// we consider all the following fields, when falsy, as equivalent to be missing. If this changes in the future, please adjust addAccount and setAccount
const assignableProps: (keyof Account)[] = ['redirect','ignore_limits','belongs','admin','disabled','disable_password_change']

export function addAccount(username: string, props: Partial<Account>) {
    username = normalizeUsername(username)
    if (!username || getAccount(username, false))
        return
    const filteredProps = _.pickBy(_.pick(props, assignableProps), Boolean)
    const copy: Account = setHidden(filteredProps, { username }) // have the field in the object but hidden so that stringification won't include it
    accountsConfig.set(accounts =>
        Object.assign(accounts, { [username]: copy }))
    return copy
}

export function setAccount(acc: Account, changes: Partial<Account>) {
    const rest = _.pick(changes, assignableProps)
    for (const [k,v] of Object.entries(rest))
        if (!v)
            rest[k as keyof Account] = undefined
    Object.assign(acc, rest)
    if (changes.username)
        renameAccount(acc.username, changes.username)
    saveAccountsAsap()
    return acc
}

export function delAccount(username: string) {
    if (!getAccount(username))
        return false
    accountsConfig.set(accounts =>
        _.omit(accounts, normalizeUsername(username)) )
    saveAccountsAsap()
    return true
}

// get some property from account, searching in its groups if necessary. Search is breadth-first, and this determines priority of inheritance.
export function getFromAccount<T=any>(account: Account | string, getter:(a:Account) => T) {
    const search = [account]
    for (const accountOrUsername of search) {
        const a = typeof accountOrUsername === 'string' ? getAccount(accountOrUsername) : accountOrUsername
        if (!a) continue
        const res = getter(a)
        if (res !== undefined)
            return res
        if (a.belongs)
            search.push(...a.belongs)
    }
}

export function accountHasPassword(account: Account) {
    return Boolean(account.password || account.hashed_password || account.srp)
}

export function accountCanLogin(account: Account) {
    return accountHasPassword(account) && !allDisabled(account)
}

function allDisabled(account: Account): boolean {
    return Boolean(account.disabled || account.belongs?.map(u => getAccount(u, false)).every(a => a && allDisabled(a)))
}

export function accountCanLoginAdmin(account: Account) {
    return accountCanLogin(account) && Boolean(getFromAccount(account, a => a.admin))
}
