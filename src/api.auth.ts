// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    Account, accountCanLogin, accountIsDisabled, accountCanChangePassword, expandUsername, getAccount, normalizeUsername,
    updateAccount, saveSrpInfo
} from './perm'
import { ApiError, ApiHandler, ApiHandlers } from './apiMiddleware'
import { SRPServerSessionStep1 } from 'tssrp6a'
import {
    ADMIN_URI,
    HTTP_UNAUTHORIZED, HTTP_BAD_REQUEST, HTTP_SERVER_ERROR, HTTP_CONFLICT, HTTP_NOT_FOUND, HTTP_METHOD_NOT_ALLOWED
} from './const'
import { ctxAdminAccess } from './adminApis'
import { failAllowNet, sessionDuration } from './middlewares'
import { clearTextLogin, getCurrentUsername, setLoggedIn, srpServerStep1 } from './auth'
import { defineConfig } from './config'
import events from './events'
import { apiAssertTypes, CFG } from './misc'
import { getSessionId } from './uploadOwners'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'

const ongoingLogins:Record<string, SRPServerSessionStep1> = {} // store data that doesn't fit session object
const keepSessionAlive = defineConfig(CFG.keep_session_alive, true)
const fakeSrpSecret = randomBytes(32)

const refresh_session: ApiHandler = async ({}, ctx) => {
    if (!ctx.session)
        return new ApiError(HTTP_SERVER_ERROR)
    getSessionId(ctx) // anonymous upload ownership must be bound before any abortible upload request
    const username = getCurrentUsername(ctx)
    const isAdmin = ctxAdminAccess(ctx) || undefined
    return {
        username,
        expandedUsername: Array.from(expandUsername(username)),
        isAdmin,
        adminUrl: isAdmin && ctx.state.revProxyPath + ADMIN_URI,
        canChangePassword: accountCanChangePassword(ctx.state.account),
        requireChangePassword: ctx.state.account?.require_password_change,
        exp: username && keepSessionAlive.get() ? new Date(Date.now() + sessionDuration.compiled()) : undefined,
        accountExp: ctx.state.account?.expire,
    }
}

export const authApis = {

    async login({ username, password }, ctx) {
        if (!username)
            return new ApiError(HTTP_BAD_REQUEST)
        if (!ctx.session)
            return new ApiError(HTTP_SERVER_ERROR)
        try {
            const account = await clearTextLogin(ctx, username, password, 'api')
            if (!account)
                return new ApiError(HTTP_UNAUTHORIZED)
            await setLoggedIn(ctx, account.username)
        }
        catch (e) {
            return new ApiError(HTTP_UNAUTHORIZED, String(e))
        }
        return {
            redirect: ctx.state.account?.redirect,
            ...await refresh_session({}, ctx)
        }
    },

    async loginSrp1({ username }, ctx) {
        apiAssertTypes({ string: { username } })
        if (!username)
            return new ApiError(HTTP_BAD_REQUEST)
        const account = getAccount(username)
        if (!ctx.session)
            return new ApiError(HTTP_SERVER_ERROR)
        if (account?.plugin?.auth) // tell client to do clear-text login, before firing attemptingLogin, before triggering anti-brute
            return new ApiError(HTTP_METHOD_NOT_ALLOWED)
        if ((await events.emitAsync('attemptingLogin', { ctx, username }))?.isDefaultPrevented()) return
        if (account && !accountCanLogin(account)) {
            ctx.logExtra({ u: username })
            ctx.state.dontLog = false // log even if log_api is false
            return unauthorized(accountIsDisabled(account) ? 'Account disabled' : undefined)
        }
        if (account && failAllowNet(ctx, account))
            return unauthorized()
        try { // unknown users complete step 1 so only a full failed login can reveal and penalize the attempt
            const { srpServer, ...rest } = await srpServerStep1(account || fakeSrpAccount(username))
            // keep the public handshake identifier independent of predictable application PRNG state
            const sid = randomUUID()
            ongoingLogins[sid] = srpServer
            setTimeout(()=> delete ongoingLogins[sid], 60_000) // client must complete api sequence (loginSrp2) within 1 minute or will be discarded to avoid memory leaks
            ctx.session.loggingIn = { username, sid } // temporarily store until process is complete
            return rest
        }
        catch (code: any) {
            return new ApiError(code)
        }

        function unauthorized(message?: string) {
            events.emit('failedLogin', { ctx, username })
            return new ApiError(HTTP_UNAUTHORIZED, message)
        }

        function fakeSrpAccount(username: string): Account {
            username = normalizeUsername(username)
            return {
                username,
                // process-secret derivation keeps fake credentials stable per username without storing attacker-controlled names
                srp: `${derive('salt')}|${derive('verifier')}`,
            }

            function derive(field: string) {
                return BigInt('0x' + createHmac('sha256', fakeSrpSecret).update(field).update(username).digest('hex')).toString()
            }
        }
    },

    async loginSrp2({ pubKey, proof }, ctx) {
        if (!ctx.session)
            return new ApiError(HTTP_SERVER_ERROR)
        if (!ctx.session.loggingIn)
            return new ApiError(HTTP_CONFLICT)
        const { username, sid } = ctx.session.loggingIn
        delete ctx.session.loggingIn
        const step1 = ongoingLogins[sid]
        if (!step1)
            return new ApiError(HTTP_NOT_FOUND)
        try {
            const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
                .catch(() => { throw '' }) // falsy value for later
            await setLoggedIn(ctx, username)
            return {
                proof: String(M2),
                redirect: ctx.state.account?.redirect,
                ...await refresh_session({}, ctx)
            }
        }
        catch(e) {
            ctx.logExtra({ u: username })
            ctx.state.dontLog = false // log even if log_api is false
            events.emit('failedLogin', { ctx, username })
            return new ApiError(HTTP_UNAUTHORIZED, e ? String(e) : undefined)
        }
        finally {
            delete ongoingLogins[sid]
        }
    },

    async logout({}, ctx) {
        if (!ctx.session)
            return new ApiError(HTTP_SERVER_ERROR)
        await setLoggedIn(ctx, false)
        // 401 is a convenient code for OK: the browser clears a possible http authentication (hopefully), and Admin automatically triggers login dialog
        return new ApiError(HTTP_UNAUTHORIZED)
    },

    refresh_session,

    async change_srp({ username, salt, verifier }, ctx) {
        const a = username && getAccount(username)
        const can = a && (ctxAdminAccess(ctx) || username === getCurrentUsername(ctx) && accountCanChangePassword(a))
        if (!can)
            return new ApiError(HTTP_UNAUTHORIZED)
        if (!salt || !verifier)
            return new ApiError(HTTP_BAD_REQUEST, 'missing parameters')
        await updateAccount(a, a =>
            saveSrpInfo(a, salt, verifier) )
        delete a.require_password_change
        return {}
    }

} as const satisfies ApiHandlers
