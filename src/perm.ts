// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { HTTP_BAD_REQUEST, objRenameKey, objSameKeys, setHidden, typedEntries, wantArray } from './misc'
import { defineConfig, saveConfigAsap } from './config'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import events from './events'
import { ApiError } from './apiMiddleware'

export interface Account {
    // we consider all the following fields, when falsy, as equivalent to be missing. If this changes in the future, please adjust addAccount and setAccount
    username: string, // we keep username property (hidden) so we don't need to pass it separately
    password?: string
    srp?: string
    belongs?: string[]
    ignore_limits?: boolean
    disable_password_change?: boolean
    admin?: boolean
    redirect?: string
    disabled?: boolean
    expire?: Date
    days_to_live?: number
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

const createAdminConfig = defineConfig('create-admin', '')
createAdminConfig.sub(v => {
    if (!v) return
    createAdminConfig.set('')
    // we can't createAdmin right away, as its changes will be lost after return, when our caller (setConfig) applies undefined properties. setTimeout is good enough, as the process is sync.
    setTimeout(() => createAdmin(v))
})

export async function createAdmin(password: string, username='admin') {
    const acc = await addAccount(username, { admin: true, password }, true)
    console.log(acc ? "account admin set" : "something went wrong")
}

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())

type Changer = (account:Account)=> void | Promise<void>
export async function updateAccount(account: Account, change: Partial<Account> | Changer) {
    const jsonWas = JSON.stringify(account)
    const { username: usernameWas } = account
    if (typeof change === 'function')
        await change?.(account)
    else
        Object.assign(account, objSameKeys(change, x => x || undefined))
    for (const [k,v] of typedEntries(account))
        if (!v) delete account[k] // we consider all account fields, when falsy, as equivalent to be missing (so, default value applies)
    const { username, password } = account
    if (password) {
        console.debug('hashing password for', username)
        delete account.password
        const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
        saveSrpInfo(account, res.s, res.v)
    }
    if (account.belongs) {
        account.belongs = wantArray(account.belongs)
        _.remove(account.belongs, b => {
            if (accounts.hasOwnProperty(b)) return
            console.error(`account ${username} belongs to non-existing ${b}`)
            return true
        })
        if (!account.belongs.length)
            delete account.belongs
    }
    account.expire &&= new Date(account.expire)
    if (username !== usernameWas)
        renameAccount(usernameWas, username)
    if (jsonWas !== JSON.stringify(account)) // this test will miss the 'username' field, because hidden, but renameAccount is already calling saveAccountsASAP
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
        void updateAccount(rec, {}) // work fields
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

export async function addAccount(username: string, props: Partial<Account>, updateExisting=false) {
    username = normalizeUsername(username)
    if (!username) return
    let account = getAccount(username, false)
    if (account && !updateExisting) return
    account = setHidden(account || {}, { username })  // hidden so that stringification won't include it
    Object.assign(account, _.pickBy(props, Boolean))
    accountsConfig.set(accounts =>
        Object.assign(accounts, { [username]: account }))
    await updateAccount(account, account)
    return account
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
    return Boolean(account.password || account.srp)
}

export function accountCanLogin(account: Account) {
    return accountHasPassword(account) && !allDisabled(account)
}

function allDisabled(account: Account): boolean {
    return Boolean(account.disabled
        || account.expire as any < Date.now()
        || account.belongs?.length // don't every() on empty array, as it returns true
        && account.belongs.map(u => getAccount(u, false)).every(a => a && allDisabled(a)) )
}

export function accountCanLoginAdmin(account: Account) {
    return accountCanLogin(account) && Boolean(getFromAccount(account, a => a.admin))
}


export async function changeSrpHelper(account: Account, salt: string, verifier: string) {
    if (!salt || !verifier)
        return new ApiError(HTTP_BAD_REQUEST, 'missing parameters')
    await updateAccount(account, account =>
        saveSrpInfo(account, salt, verifier) )
    return {}
}