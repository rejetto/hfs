import { getAccount, getCurrentUsername, saveSrpInfo, updateAccount } from './perm'
import { verifyPassword } from './crypt'
import { CFG_ALLOW_CLEAR_TEXT_LOGIN, getConfig } from './config'
import { ApiError, ApiHandler } from './apis'
import { SRPParameters, SRPRoutines, SRPServerSession, SRPServerSessionStep1 } from 'tssrp6a'
import { SESSION_DURATION } from './index'
import { randomId } from './misc'
import Koa from 'koa'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
const srpSession = new SRPServerSession(srp6aNimbusRoutines)
const ongoingLogins:Record<string,SRPServerSessionStep1> = {}

// centralized log-in state
function loggedIn(ctx:Koa.Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(500,'session')
    if (username === false) {
        delete s.username
        ctx.cookies.set('csrf', '')
        return
    }
    s.username = username
    ctx.cookies.set('csrf', randomId(), { signed:false, httpOnly: false })
}

function makeExp() {
    return { exp: new Date(Date.now() + SESSION_DURATION) }
}

export const login: ApiHandler = async ({ username, password }, ctx) => {
    if (!username)
        return new ApiError(400)
    if (!password)
        return new ApiError(400)
    username = username.toLocaleLowerCase()
    const acc = getAccount(username)
    if (!acc)
        return new ApiError(401)
    if (!acc.hashed_password)
        return new ApiError(406)
    if (!await verifyPassword(acc.hashed_password, password))
        return new ApiError(401)
    if (!ctx.session)
        return new ApiError(500)
    loggedIn(ctx, username)
    return { ...makeExp(), redirect: acc.redirect }
}

export const loginSrp1: ApiHandler = async ({ username }, ctx) => {
    if (!username)
        return new ApiError(400)
    username = username.toLocaleLowerCase()
    const account = getAccount(username)
    if (!ctx.session)
        return new ApiError(500)
    if (!account) // TODO simulate fake account to prevent knowing valid usernames
        return new ApiError(401)
    if (!account.srp)
        return new ApiError(406) // unacceptable

    const [salt, verifier] = account.srp.split('|')
    const step1 = await srpSession.step1(account.username, BigInt(salt), BigInt(verifier))
    const sid = Math.random()
    ongoingLogins[sid] = step1
    setTimeout(()=> delete ongoingLogins[sid], 60_000)

    ctx.session.login = { username, sid }
    return { salt, pubKey: String(step1.B) } // cast to string cause bigint can't be jsonized
}

export const loginSrp2: ApiHandler = async ({ pubKey, proof }, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    const { username, sid } = ctx.session.login
    const step1 = ongoingLogins[sid]
    try {
        const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
        loggedIn(ctx, username)
        const acc = getAccount(username)
        return { proof: String(M2), redirect: acc?.redirect, ...makeExp() }
    }
    catch(e) {
        return new ApiError(401, String(e))
    }
    finally {
        delete ongoingLogins[sid]
        delete ctx.session.login
    }
}

export const logout: ApiHandler = async ({}, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    loggedIn(ctx, false)
    return {}
}

export const refresh_session: ApiHandler = async ({}, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    return { username: getCurrentUsername(ctx), ...makeExp() }
}

export const change_password: ApiHandler = async ({ newPassword }, ctx) => {
    if (!newPassword) // clear text version
        return Error('missing parameters')
    if (!ctx.account)
        return new ApiError(401)
    await updateAccount(ctx.account, account => {
        account.password = newPassword
    })
    return {}
}

export const change_srp: ApiHandler = async ({ salt, verifier }, ctx) => {
    if (getConfig(CFG_ALLOW_CLEAR_TEXT_LOGIN))
        return new ApiError(406)
    if (!salt || !verifier)
        return Error('missing parameters')
    if (!ctx.account)
        return new ApiError(401)
    await updateAccount(ctx.account, account => {
        saveSrpInfo(account, salt, verifier)
        delete account.hashed_password // remove leftovers
    })
    return {}
}

