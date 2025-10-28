// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { HTTP_BAD_REQUEST, objRenameKey, objSameKeys, setHidden, typedEntries, wantArray } from './misc'
import { defineConfig, saveConfigAsap } from './config'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import events from './events'
import { ApiError } from './apiMiddleware'
import { getCurrentUsername } from './auth'
import Koa from 'koa'

// for all the Account fields, falsy values must be equivalent to undefined. If this changes in the future, please adjust addAccount and setAccount
export interface Account {
    username: string, // we keep username property for convenience, but hidden as we don't persist it inside the object, but as key of the accounts map
    password?: string
    srp?: string
    belongs?: string[]
    ignore_limits?: boolean
    disable_password_change?: boolean
    admin?: boolean
    redirect?: string
    disabled?: boolean
    expire?: Date
    days_to_live?: number // this is not inherited, but it will affect sub-accounts via 'expire'
    allow_net?: string
    require_password_change?: boolean // not inherited
    notes?: string
    plugin?: { id?: string, auth?: boolean, [rest: string]: unknown }
}
interface Accounts { [username:string]: Account }

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

// check if current username or any ancestor match the provided usernames
export function ctxBelongsTo(ctx: Koa.Context, usernames: string[]) {
    return (ctx.state.usernames ||= expandUsername(getCurrentUsername(ctx))) // cache ancestors' usernames inside context state
        .some((u: string) => usernames.includes(u))
}

export function getUsernames() {
    return Object.keys(accounts.get())
}

export function getAccount(username:string, normalize=true) : Account | undefined {
    if (normalize)
        username = normalizeUsername(username)
    return username ? accounts.get()[username] : undefined
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
    else {
        const u = normalizeUsername(change.username || '')
        if (u && u !== usernameWas && getAccount(u))
            throw "username already exists"
        Object.assign(account, objSameKeys(change, x => x || undefined))
    }
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
            if (accounts.get().hasOwnProperty(b)) return
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

export const accounts = defineConfig('accounts', {} as Accounts)
accounts.sub(_.debounce(obj => {
    // consider some validation here, in case of manual edit of the config
    _.each(obj, (rec,k) => {
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
})) // don't trigger in the middle of a series of deletion, as we may have an inconsistent state

export function normalizeUsername(username: string) {
    return username.toLocaleLowerCase()
}

export function renameAccount(from: string, to: string) {
    from = normalizeUsername(from)
    const as = accounts.get()
    to = normalizeUsername(to)
    if (!to || !as[from] || as[to])
        return false
    if (to === from)
        return true
    objRenameKey(as, from, to)
    setHidden(as[to], { username: to })
    // update references
    for (const a of Object.values(as)) {
        const idx = a.belongs?.indexOf(from)
        if (idx !== undefined && idx >= 0)
            a.belongs![idx] = to
    }
    accounts.set(as)
    events.emit('accountRenamed', { from, to }) // everybody, take care of your stuff
    saveAccountsAsap()
    return true
}

export function addAccount(username: string, props: Partial<Account>, updateExisting=false) {
    username = normalizeUsername(username)
    if (!username) return
    let account = getAccount(username, false)
    if (account && !updateExisting) return
    account = setHidden(account || {}, { username })  // hidden so that stringification won't include it
    Object.assign(account, _.pickBy(props, Boolean))
    accounts.set(was =>
        Object.assign(was, { [username]: account }))
    return updateAccount(account, account).then(() => account!)
}

export function delAccount(username: string) {
    if (!getAccount(username))
        return false
    accounts.set(was => _.omit(was, normalizeUsername(username)) )
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
    return (accountHasPassword(account) || account.plugin?.auth) && !accountIsDisabled(account)
}

export function accountIsDisabled(account: Account): boolean {
    return Boolean(account.disabled
        || account.expire as any < Date.now()
        || account.belongs?.length // don't every() on empty array, as it returns true
        && account.belongs.map(u => getAccount(u, false)).every(a => a && accountIsDisabled(a)) )
}

export function accountCanLoginAdmin(account: Account) {
    return accountCanLogin(account) && getFromAccount(account, a => a.admin) || false
}

export function accountCanChangePassword(account: Account | undefined) {
    return account && !getFromAccount(account, a => a.disable_password_change)
}

export async function changeSrpHelper(account: Account, salt: string, verifier: string) {
    if (!salt || !verifier)
        return new ApiError(HTTP_BAD_REQUEST, 'missing parameters')
    await updateAccount(account, account =>
        saveSrpInfo(account, salt, verifier) )
    return {}
}