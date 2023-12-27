import { Account, getAccount, normalizeUsername } from './perm'
import { HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR } from './cross-const'
import { SRPParameters, SRPRoutines, SRPServerSession } from 'tssrp6a'
import { Context } from 'koa'
import { prepareState } from './middlewares'
import { srpClientPart } from './srp'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())

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

export async function srpCheck(username: string, password: string) {
    const account = getAccount(username)
    if (!account?.srp || !password) return
    const { step1, salt, pubKey } = await srpStep1(account)
    const client = await srpClientPart(username, password, salt, pubKey)
    return await step1.step2(client.A, client.M1).then(() => account, () => {})
}

export function getCurrentUsername(ctx: Context): string {
    return ctx.state.account?.username || ''
}

// centralized log-in state
export async function loggedIn(ctx: Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(HTTP_SERVER_ERROR,'session')
    if (username === false) {
        delete s.username
        return
    }
    invalidSessions.delete(username)
    s.username = normalizeUsername(username)
    await prepareState(ctx, async ()=>{}) // updating the state is necessary to send complete session data so that frontend shows admin button
}

export const invalidSessions = new Set<string>() // since session are currently stored in cookies, we need to memorize this until we meet again
