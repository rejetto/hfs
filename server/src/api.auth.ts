// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Account, getAccount, getCurrentUsername } from './perm'
import { verifyPassword } from './crypt'
import { ApiError, ApiHandler } from './apiMiddleware'
import { SRPParameters, SRPRoutines, SRPServerSession, SRPServerSessionStep1 } from 'tssrp6a'
import { ADMIN_URI, SESSION_DURATION, UNAUTHORIZED } from './const'
import { randomId } from './misc'
import Koa from 'koa'
import { changeSrpHelper, changePasswordHelper } from './api.helpers'
import { ctxAdminAccess } from './adminApis'
import { prepareState } from './middlewares'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
const ongoingLogins:Record<string,SRPServerSessionStep1> = {} // store data that doesn't fit session object

// centralized log-in state
async function loggedIn(ctx:Koa.Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(500,'session')
    if (username === false) {
        delete s.username
        ctx.cookies.set('csrf', '')
        return
    }
    s.username = username
    await prepareState(ctx, async ()=>{}) // updating the state is necessary to send complete session data so that frontend shows admin button
    delete s.login
    ctx.cookies.set('csrf', randomId(), { signed:false, httpOnly: false })
}

function makeExp() {
    return { exp: new Date(Date.now() + SESSION_DURATION) }
}

export const login: ApiHandler = async ({ username, password }, ctx) => {
    if (!username || !password) // some validation
        return new ApiError(400)
    username = username.toLocaleLowerCase() // normalize username, to be case-insensitive
    const acc = getAccount(username)
    if (!acc)
        return new ApiError(UNAUTHORIZED)
    if (!acc.hashed_password)
        return new ApiError(406)
    if (!await verifyPassword(acc.hashed_password, password))
        return new ApiError(UNAUTHORIZED)
    if (!ctx.session)
        return new ApiError(500)
    await loggedIn(ctx, username)
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
        return new ApiError(UNAUTHORIZED)
    try {
        const { step1, ...rest } = await srpStep1(account)
        const sid = Math.random()
        ongoingLogins[sid] = step1
        setTimeout(()=> delete ongoingLogins[sid], 60_000)
        ctx.session.login = { username, sid }
        return rest
    }
    catch (code: any) {
        return new ApiError(code)
    }
}

export async function srpStep1(account: Account) {
    if (!account.srp)
        throw 406 // unacceptable
    const [salt, verifier] = account.srp.split('|')
    const srpSession = new SRPServerSession(srp6aNimbusRoutines)
    const step1 = await srpSession.step1(account.username, BigInt(salt), BigInt(verifier))
    return { step1, salt, pubKey: String(step1.B) } // cast to string cause bigint can't be jsonized
}

export const loginSrp2: ApiHandler = async ({ pubKey, proof }, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    if (!ctx.session.login)
        return new ApiError(409)
    const { username, sid } = ctx.session.login
    const step1 = ongoingLogins[sid]
    try {
        const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
        await loggedIn(ctx, username)
        return {
            proof: String(M2),
            redirect: ctx.state.account?.redirect,
            ...await refresh_session({},ctx)
        }
    }
    catch(e) {
        return new ApiError(UNAUTHORIZED, String(e))
    }
    finally {
        delete ongoingLogins[sid]
    }
}

export const logout: ApiHandler = async ({}, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    loggedIn(ctx, false)
    // 401 is a convenient code for OK: the browser clears a possible http authentication (hopefully), and Admin automatically triggers login dialog
    return new ApiError(401)
}

export const refresh_session: ApiHandler = async ({}, ctx) => {
    return !ctx.session ? new ApiError(500) : {
        username: getCurrentUsername(ctx),
        adminUrl: ctxAdminAccess(ctx) ? ADMIN_URI : undefined,
        ...makeExp(),
    }
}

export const change_password: ApiHandler = async ({ newPassword }, ctx) => {
    return changePasswordHelper(ctx.state.account, newPassword)
}

export const change_srp: ApiHandler = async ({ salt, verifier }, ctx) => {
    return changeSrpHelper(ctx.state.account, salt, verifier)
}
