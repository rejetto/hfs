// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Account, getAccount, getCurrentUsername, normalizeUsername } from './perm'
import { verifyPassword } from './crypt'
import { ApiError, ApiHandler } from './apiMiddleware'
import { SRPParameters, SRPRoutines, SRPServerSession, SRPServerSessionStep1 } from 'tssrp6a'
import {
    ADMIN_URI,
    HTTP_UNAUTHORIZED, HTTP_BAD_REQUEST, HTTP_SERVER_ERROR, HTTP_NOT_ACCEPTABLE, HTTP_CONFLICT, HTTP_NOT_FOUND
} from './const'
import { randomId } from './misc'
import Koa from 'koa'
import { changeSrpHelper, changePasswordHelper } from './api.helpers'
import { ctxAdminAccess } from './adminApis'
import { prepareState, sessionDuration } from './middlewares'
import { defineConfig } from './config'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
const ongoingLogins:Record<string,SRPServerSessionStep1> = {} // store data that doesn't fit session object
const keepSessionAlive = defineConfig('keep_session_alive', true)

// centralized log-in state
async function loggedIn(ctx:Koa.Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(HTTP_SERVER_ERROR,'session')
    if (username === false) {
        delete s.username
        ctx.cookies.set('csrf', '')
        return
    }
    s.username = normalizeUsername(username)
    await prepareState(ctx, async ()=>{}) // updating the state is necessary to send complete session data so that frontend shows admin button
    delete s.login
    ctx.cookies.set('csrf', randomId(), { signed:false, httpOnly: false })
}

function makeExp() {
    return !keepSessionAlive.get() ? undefined
        : { exp: new Date(Date.now() + sessionDuration.compiled()) }
}

export const login: ApiHandler = async ({ username, password }, ctx) => {
    if (!username || !password) // some validation
        return new ApiError(HTTP_BAD_REQUEST)
    const acc = getAccount(username)
    if (!acc)
        return new ApiError(HTTP_UNAUTHORIZED)
    if (!acc.hashed_password)
        return new ApiError(HTTP_NOT_ACCEPTABLE)
    if (!await verifyPassword(acc.hashed_password, password))
        return new ApiError(HTTP_UNAUTHORIZED)
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    await loggedIn(ctx, username)
    return { ...makeExp(), redirect: acc.redirect }
}

export const loginSrp1: ApiHandler = async ({ username }, ctx) => {
    if (!username)
        return new ApiError(HTTP_BAD_REQUEST)
    const account = getAccount(username)
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    if (!account) // TODO simulate fake account to prevent knowing valid usernames
        return new ApiError(HTTP_UNAUTHORIZED)
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
        throw HTTP_NOT_ACCEPTABLE
    const [salt, verifier] = account.srp.split('|')
    if (!salt || !verifier)
        throw Error("malformed account")
    const srpSession = new SRPServerSession(srp6aNimbusRoutines)
    const step1 = await srpSession.step1(account.username, BigInt(salt), BigInt(verifier))
    return { step1, salt, pubKey: String(step1.B) } // cast to string cause bigint can't be jsonized
}

export const loginSrp2: ApiHandler = async ({ pubKey, proof }, ctx) => {
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    if (!ctx.session.login)
        return new ApiError(HTTP_CONFLICT)
    const { username, sid } = ctx.session.login
    const step1 = ongoingLogins[sid]
    if (!step1)
        return new ApiError(HTTP_NOT_FOUND)
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
        return new ApiError(HTTP_UNAUTHORIZED, String(e))
    }
    finally {
        delete ongoingLogins[sid]
    }
}

export const logout: ApiHandler = async ({}, ctx) => {
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    await loggedIn(ctx, false)
    // 401 is a convenient code for OK: the browser clears a possible http authentication (hopefully), and Admin automatically triggers login dialog
    return new ApiError(HTTP_UNAUTHORIZED)
}

export const refresh_session: ApiHandler = async ({}, ctx) => {
    return !ctx.session ? new ApiError(HTTP_SERVER_ERROR) : {
        username: getCurrentUsername(ctx),
        adminUrl: ctxAdminAccess(ctx) ? ctx.state.revProxyPath + ADMIN_URI : undefined,
        ...makeExp(),
    }
}

export const change_password: ApiHandler = async ({ newPassword }, ctx) => {
    return changePasswordHelper(ctx.state.account, newPassword)
}

export const change_srp: ApiHandler = async ({ salt, verifier }, ctx) => {
    return changeSrpHelper(ctx.state.account, salt, verifier)
}
