import { Account, getAccount, normalizeUsername, updateAccount } from './perm'
import { ALLOW_SESSION_IP_CHANGE, HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR } from './cross-const'
import { SRPParameters, SRPRoutines, SRPServerSession } from 'tssrp6a'
import { Context } from 'koa'
import { srpClientPart } from './srp'
import { DAY } from './cross'
import { expiringCache } from './expiringCache'
import { createHash } from 'node:crypto'
import events from './events'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())

export async function srpServerStep1(account: Account) {
    if (!account.srp)
        throw HTTP_NOT_ACCEPTABLE
    const [salt, verifier] = account.srp.split('|')
    if (!salt || !verifier)
        throw Error("malformed account")
    const srpSession = new SRPServerSession(srp6aNimbusRoutines)
    const srpServer = await srpSession.step1(account.username, BigInt(salt), BigInt(verifier))
    return { srpServer, salt, pubKey: String(srpServer.B) } // cast to string cause bigint can't be jsonized
}

const cache = expiringCache<Promise<boolean>>(60_000)
export async function srpCheck(username: string, password: string) {
    const account = getAccount(username)
    if (!account?.srp || !password) return
    const k = createHash('sha256').update(username + password + account.srp).digest("hex")
    const good = await cache.try(k, async () => {
        const { srpServer, salt, pubKey } = await srpServerStep1(account)
        const client = await srpClientPart(username, password, salt, pubKey)
        return srpServer.step2(client.A, client.M1).then(() => true, () => false)
    })
    return good ? account : undefined
}

export function getCurrentUsername(ctx: Context): string {
    return ctx.state.account?.username || ''
}

export async function clearTextLogin(ctx: Context, u: string, p: string, via: string) {
    if (!p) return
    if ((await events.emitAsync('attemptingLogin', { ctx, username: u, via }))?.isDefaultPrevented()) return
    const plugins = await events.emitAsync('clearTextLogin', { ctx, username: u, password: p, via }) // provide clear password to plugins
    const a = plugins?.some(x => x === true) ? getAccount(u) : await srpCheck(u, p)
    if (a) {
        await setLoggedIn(ctx, a.username)
        ctx.headers['x-username'] = a.username // give an easier way to determine if the login was successful
    }
    else if (u)
        events.emit('failedLogin', { ctx, username: u, via })
    return a
}

// centralized log-in state
export async function setLoggedIn(ctx: Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(HTTP_SERVER_ERROR,'session')
    delete ctx.state.usernames
    if (username === false) {
        events.emit('logout', ctx)
        delete ctx.state.account
        delete s.username
        delete s.allowNet
        return
    }
    const a = ctx.state.account = getAccount(username)
    if (!a) return
    await events.emitAsync('finalizingLogin', { ctx, username, inputs: { ...ctx.state.params, ...ctx.query } })
    s.username = normalizeUsername(username)
    s.ts = Date.now()
    const k = ALLOW_SESSION_IP_CHANGE
    s[k] = k in ctx.query || Boolean(ctx.state.params?.[k]) || undefined // login APIs will get ctx.state.params, others can rely on ctx.query
    if (!a.expire && a.days_to_live)
        updateAccount(a, { expire: new Date(Date.now() + a.days_to_live! * DAY) })
    await events.emitAsync('login', ctx)
}

// since session are currently stored in cookies, we need to store this information
export const invalidateSessionBefore = new Map<string, number>()
