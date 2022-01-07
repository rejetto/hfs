import { vfs, VfsNode, walkNode } from './vfs'
import _ from 'lodash'
import createSSE from './sse'
import { basename } from 'path'
import { getAccount, getCurrentUsername, saveSrpInfo, updateAccount } from './perm'
import { stat } from 'fs/promises'
import { ApiHandlers } from './apis'
import { plugins } from './plugins'
import { PLUGINS_PUB_URI } from './const'
import { SRPParameters, SRPRoutines, SRPServerSession, SRPServerSessionStep1 } from 'tssrp6a'
import { SESSION_DURATION } from './index'
import { verifyPassword } from './crypt'
import { CFG_ALLOW_CLEAR_TEXT_LOGIN, getConfig } from './config'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
const srpSession = new SRPServerSession(srp6aNimbusRoutines)
const ongoingLogins:Record<string,SRPServerSessionStep1> = {}

export const frontEndApis: ApiHandlers = {

    async file_list({ path, offset, limit, search, omit, sse }, ctx) {
        let node = await vfs.urlToNode(path || '/', ctx)
        if (!node)
            return
        if (search?.includes('..'))
            return ctx.throw(400)
        if (node.default)
            return { redirect: path }
        offset = Number(offset)
        limit = Number(limit)
        const re = new RegExp(_.escapeRegExp(search),'i')
        const match = (s?:string) => !s || !search || re.test(s)
        const walker = walkNode(node, ctx, search ? Infinity : 0)
        const sseSrv = sse ? createSSE(ctx) : null
        const res = produceEntries()
        return !sseSrv && { list: await res }

        async function produceEntries() {
            const list = []
            for await (const sub of walker) {
                if (sseSrv?.stopped || ctx.aborted) break
                const filename = basename(sub.name||'')
                if (!match(filename))
                    continue
                const entry = await nodeToDirEntry(sub)
                if (!entry)
                    continue
                if (offset) {
                    --offset
                    continue
                }
                if (omit) {
                    if (omit !== 'c')
                        ctx.throw(400, 'omit')
                    if (!entry.m)
                        entry.m = entry.c
                    delete entry.c
                }
                if (sseSrv)
                    sseSrv.send({ entry })
                else
                    list.push(entry)
                if (limit && !--limit)
                    break
            }
            sseSrv?.close()
            return list
        }
    },

    async login({ user, password }, ctx) {
        if (!user)
            return ctx.status = 400
        if (!password)
            return ctx.status = 400
        const acc = getAccount(user)
        if (!acc)
            return ctx.status = 401
        if (!acc.hashedPassword)
            return ctx.status = 406
        if (!await verifyPassword(acc.hashedPassword, password))
            return ctx.status = 401
        if (ctx.session)
            ctx.session.user = user
        return makeExp()
    },

    async loginSrp1({ user }, ctx) {
        const account = getAccount(user)
        if (!ctx.session)
            return ctx.throw(500)
        if (!account) // TODO simulate fake account to prevent knowing valid usernames
            return ctx.status = 401
        if (!account.srp)
            return ctx.status = 406 // unacceptable

        const [salt, verifier] = account.srp.split('|')
        const step1 = await srpSession.step1(account.user, BigInt(salt), BigInt(verifier))
        const sid = Math.random()
        ongoingLogins[sid] = step1
        setTimeout(()=> delete ongoingLogins[sid], 60_000)

        ctx.session.login = { user, sid }
        return { salt, pubKey: String(step1.B) } // cast to string cause bigint can't be jsonized
    },

    async loginSrp2({ pubKey, proof }, ctx) {
        if (!ctx.session)
            return ctx.throw(500)
        const { user, sid } = ctx.session.login
        const step1 = ongoingLogins[sid]
        try {
            const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
            ctx.session.user = user
            return { proof: String(M2), ...makeExp() }
        }
        catch(e) {
            ctx.body = String(e)
            ctx.status = 401
        }
    },

    async logout({}, ctx) {
        if (ctx.session)
            ctx.session.user = undefined
        ctx.status = 200
        return true
    },

    async refresh_session({}, ctx) {
        return { user: ctx.session?.user, ...makeExp() }
    },

    async change_password({ newPassword }, ctx) {
        if (!newPassword) // clear text version
            return Error('missing parameters')
        await updateAccount(await getCurrentUsername(ctx), account => {
            account.password = newPassword
        })
        return true
    },

    async change_srp({ salt, verifier }, ctx) {
        if (getConfig(CFG_ALLOW_CLEAR_TEXT_LOGIN))
            return ctx.status = 406
        if (!salt || !verifier)
            return Error('missing parameters')
        await updateAccount(await getCurrentUsername(ctx), account => {
            saveSrpInfo(account, salt, verifier)
            delete account.hashedPassword // remove leftovers
        })
        return true
    },

    async extras_to_load() {
        const css = []
        for (const [k,plug] of Object.entries(plugins))
            if (plug.frontend_css)
                css.push( ...plug.frontend_css.map(f => PLUGINS_PUB_URI + k + '/' + f) )
        return { css }
    },
}

interface DirEntry { n:string, s?:number, m?:Date, c?:Date }

async function nodeToDirEntry(node: VfsNode): Promise<DirEntry | null> {
    try {
        let { name, source, default:def } = node
        if (source?.includes('//'))
            return { n: name || source }
        if (source) {
            if (!name)
                name = basename(source)
            if (def)
                return { n: name }
            const st = await stat(source)
            const folder = st.isDirectory()
            const { ctime, mtime } = st
            return {
                n: name + (folder ? '/' : ''),
                c: ctime,
                m: Math.abs(+mtime-+ctime) < 1000 ? undefined : mtime,
                s: folder ? undefined : st.size,
            }
        }
        return name ? { n: name + '/' } : null
    }
    catch (err:any) {
        console.error(String(err))
        return null
    }
}

function makeExp() {
    return { exp: new Date(Date.now() + SESSION_DURATION) }
}
