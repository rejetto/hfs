// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Account, accountCanLogin, getAccount, getFromAccount } from './perm'
import { verifyPassword } from './crypt'
import { ApiError, ApiHandler } from './apiMiddleware'
import { SRPServerSessionStep1 } from 'tssrp6a'
import { ADMIN_URI, HTTP_UNAUTHORIZED, HTTP_BAD_REQUEST, HTTP_SERVER_ERROR, HTTP_NOT_ACCEPTABLE, HTTP_CONFLICT,
    HTTP_NOT_FOUND } from './const'
import { changeSrpHelper, changePasswordHelper } from './api.helpers'
import { ctxAdminAccess } from './adminApis'
import { sessionDuration } from './middlewares'
import { getCurrentUsername, loggedIn, srpStep1 } from './auth'
import { defineConfig } from './config'

const ongoingLogins:Record<string,SRPServerSessionStep1> = {} // store data that doesn't fit session object
const keepSessionAlive = defineConfig('keep_session_alive', true)

function makeExp() {
    return !keepSessionAlive.get() ? undefined
        : { exp: new Date(Date.now() + sessionDuration.compiled()) }
}

export const login: ApiHandler = async ({ username, password }, ctx) => {
    if (!username || !password) // some validation
        return new ApiError(HTTP_BAD_REQUEST)
    const account = getAccount(username)
    if (!account || !accountCanLogin(account))
        return new ApiError(HTTP_UNAUTHORIZED)
    if (!account.hashed_password)
        return new ApiError(HTTP_NOT_ACCEPTABLE)
    if (!await verifyPassword(account.hashed_password, password))
        return new ApiError(HTTP_UNAUTHORIZED)
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    await loggedIn(ctx, username)
    return { ...makeExp(), redirect: account.redirect }
}

export const loginSrp1: ApiHandler = async ({ username }, ctx) => {
    if (!username)
        return new ApiError(HTTP_BAD_REQUEST)
    const account = getAccount(username)
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    if (!account || !accountCanLogin(account)) // TODO simulate fake account to prevent knowing valid usernames
        return new ApiError(HTTP_UNAUTHORIZED)
    try {
        const { step1, ...rest } = await srpStep1(account)
        const sid = Math.random()
        ongoingLogins[sid] = step1
        setTimeout(()=> delete ongoingLogins[sid], 60_000)
        ctx.session.loggingIn = { username, sid }
        return rest
    }
    catch (code: any) {
        return new ApiError(code)
    }
}

export const loginSrp2: ApiHandler = async ({ pubKey, proof }, ctx) => {
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    if (!ctx.session.loggingIn)
        return new ApiError(HTTP_CONFLICT)
    const { username, sid } = ctx.session.loggingIn
    const step1 = ongoingLogins[sid]
    if (!step1)
        return new ApiError(HTTP_NOT_FOUND)
    try {
        const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
        await loggedIn(ctx, username)
        delete ctx.session.loggingIn
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
        canChangePassword: canChangePassword(ctx.state.account),
        ...makeExp(),
    }
}

export const change_password: ApiHandler = async ({ newPassword }, ctx) => {
    const a = ctx.state.account
    return !a || !canChangePassword(a) ? new ApiError(HTTP_UNAUTHORIZED)
        : changePasswordHelper(a, newPassword)
}

export const change_srp: ApiHandler = async ({ salt, verifier }, ctx) => {
    const a = ctx.state.account
    return !a || !canChangePassword(a) ? new ApiError(HTTP_UNAUTHORIZED)
        : changeSrpHelper(a, salt, verifier)
}

function canChangePassword(account: Account | undefined) {
    return account && !getFromAccount(account, a => a.disable_password_change)
}