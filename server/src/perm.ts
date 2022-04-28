// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { hashPassword } from './crypt'
import { objRenameKey, setHidden, wantArray } from './misc'
import Koa from 'koa'
import { defineConfig, saveConfigAsap, setConfig } from './config'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import events from './events'
import { watchLoad } from './watchLoad'
import { unlink } from 'fs'

export interface Account {
    username: string, // we'll have username in it, so we don't need to pass it separately
    password?: string
    hashed_password?: string
    srp?: string
    belongs?: string[]
    ignore_limits?: boolean
    admin?: boolean
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

export const allowClearTextLogin = defineConfig('allow_clear_text_login')

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
    if (account.belongs)
        account.belongs = wantArray(account.belongs).filter(b =>
            b in accounts // at this stage the group record may still be null if specified later in the file
            || console.error(`account ${username} belongs to non-existing ${b}`) )
    if (was !== JSON.stringify(account))
        saveAccountsAsap()
}

const saveAccountsAsap = saveConfigAsap

// legacy, remove after May 1
watchLoad('accounts.yaml', accounts => {
    if (accounts)
        setConfig(accounts)
    unlink('accounts.yaml', () => console.log("accounts file merged"))
})

defineConfig<Accounts>('accounts', {}).sub(async v => {
    // we should validate content here
    accounts = v // keep local reference
    await Promise.all(_.map(accounts, async (rec,k) => {
        const norm = normalizeUsername(k)
        if (!rec) // an empty object in yaml is stored as null
            rec = accounts[norm] = { username: norm }
        else
            objRenameKey(accounts, k, norm)
        setHidden(rec, { username: norm })
        await updateAccount(rec)
    }))
})

function normalizeUsername(username: string) {
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
const assignableProps: (keyof Account)[] = ['redirect','ignore_limits','belongs','admin']

export function addAccount(username: string, props: Partial<Account>) {
    if (!username || accounts[username])
        return
    const copy = _.pickBy(_.pick(props, assignableProps), Boolean)
    setHidden(copy, { username })
    accounts[username] = copy as typeof copy & { username: string }
    saveAccountsAsap()
    return copy
}

export function setAccount(username: string, changes: Partial<Account>) {
    const rest = _.pick(changes, assignableProps)
    for (const [k,v] of Object.entries(rest))
        if (!v)
            rest[k as keyof Account] = undefined
    Object.assign(getAccount(username), rest)
    if (changes.username)
        renameAccount(username, changes.username)
    saveAccountsAsap()
    return true
}

export function delAccount(username: string) {
    if (!getAccount(username))
        return false
    delete accounts[username]
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
    return accountHasPassword(account)
}
