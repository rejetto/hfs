import Koa from 'koa'
import { vfs, VfsNode, walkNode } from './vfs'
import { Stats } from 'fs'
import { stat } from 'fs/promises'
import _ from 'lodash'
import { getCurrentUser, verifyLogin } from './perm'
import { sessions } from './sessions'
import createSSE from './sse'
import { basename } from 'path'

export const SESSION_COOKIE = 'hfs_$id'

type ApiHandler = (params:any, ctx:Koa.Context) => any
type ApiHandlers = Record<string, ApiHandler>

export function apiMw(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        const params = ctx.method === 'POST' ? ctx.request.body : ctx.request.query
        console.debug('API', ctx.method, ctx.path, { ...params })
        if (!(ctx.path in apis))
            return ctx.throw(404, 'invalid api')
        const cb = (apis as any)[ctx.path]
        let res
        try {
            res = await cb(params||{}, ctx)
        }
        catch(e) {
            ctx.throw(500, String(e))
        }
        if (res)
            if (res instanceof Error)
                ctx.throw(400, res)
            else
                ctx.body = res
        await next()
    }
}

interface DirEntry { n:string, s?:number, m?:Date, c?:Date }

export const frontEndApis: ApiHandlers = {

    async file_list({ path, offset, limit, search, omit, sse }, ctx) {
        let node = await vfs.urlToNode(path || '/', ctx)
        if (!node)
            return
        if (search?.includes('..'))
            return ctx.throw(400)
        offset = Number(offset)
        limit = Number(limit)
        const re = new RegExp(_.escapeRegExp(search),'i')
        const match = (s?:string) => !s || !search || re.test(s)
        const who = await getCurrentUser(ctx) // cache value
        const walker = walkNode(node, who, search ? Infinity : 0)
        const sseSrv = sse ? createSSE(ctx) : null
        const res = produceEntries()
        return !sseSrv && { list: await res }

        async function produceEntries() {
            const list = []
            const h = sseSrv && setInterval(()=> console.log('WALKING'), 500)
            for await (const sub of walker) {
                if (sseSrv?.stopped) break
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
            if (h) clearInterval(h)
            sseSrv?.close()
            return list
        }
    },

    async login({ user, password }, ctx) {
        if (!user)
            return ctx.status = 400
        if (!password)
            return ctx.status = 400
        if (!await verifyLogin(user, password))
            return ctx.status = 401
        const sess = sessions.create(user)
        ctx.cookies.set(SESSION_COOKIE, sess.id)
        return sess
    },

    async logout({}, ctx) {
        const sid = ctx.cookies.get(SESSION_COOKIE)
        if (!sid)
            return ctx.status = 404
        if (!sessions.destroy(sid))
            return ctx.status = 500
        ctx.status = 200
        ctx.cookies.set(SESSION_COOKIE, null)
    },

    async refresh_session({}, ctx) {
        const prevId = ctx.cookies.get(SESSION_COOKIE)
        if (!prevId) return
        const sess = sessions.refresh(prevId)
        if (!sess) {
            ctx.cookies.set(SESSION_COOKIE)
            ctx.status = 400
            ctx.message = 'session not found'
            return
        }
        else
            ctx.cookies.set(SESSION_COOKIE, sess.id)
        return sess
    },

}

async function nodeToDirEntry(node: VfsNode): Promise<DirEntry | null> {
    try {
        return node.source?.includes('//') ? { n:node.name||'' }
            : node.source ? statToDirEntry(node.name, await stat(node.source))
                : node.name ? { n: node.name + '/' }
                    : null
    }
    catch (err:any) {
        console.error(String(err))
        return null
    }
}

function statToDirEntry(name: string | undefined, stat:Stats) {
    const folder = stat.isDirectory()
    const { ctime, mtime } = stat
    return {
        n: name + (folder ? '/' : ''),
        c: ctime,
        m: Math.abs(+mtime-+ctime) < 1000 ? undefined : mtime,
        s: folder ? undefined : stat.size,
    }
}
