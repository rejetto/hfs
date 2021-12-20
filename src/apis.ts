import Koa from 'koa'
import { directPermOnNode, vfs, VfsNode } from './vfs'
import { complySlashes, enforceFinal } from './misc'
import { Stats } from 'fs'
import { stat } from 'fs/promises'
import _ from 'lodash'
import { getCurrentUser, verifyLogin } from './perm'
import { sessions } from './sessions'
import glob from 'fast-glob'

export const SESSION_COOKIE = 'hfs_$id'

type ApiHandler = (params:any, ctx:Koa.Context) => any
type ApiHandlers = Record<string, ApiHandler>

export function apiMw(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        const params = ctx.request.body
        console.debug('API', ctx.method, ctx.path, params)
        if (!(ctx.path in apis))
            return ctx.throw(404, 'invalid api')
        ctx.body = {}
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

export const frontEndApis: ApiHandlers = {
    async file_list({ path, offset, limit }, ctx) {
        let node = await vfs.urlToNode(path || '/', ctx)
        if (!node)
            return
        const who = await getCurrentUser(ctx) // cache value
        const list = await Promise.all((node.children ||[]).map(node =>
            !node.hidden && directPermOnNode(node,who) && nodeToFile(node) ))
        _.remove(list, x => !x)
        if (offset)
            offset -= list.splice(0, offset).length
        const { source } = node
        if (list.length > limit)
            list.splice(limit)
        else if (source) {
            const base = enforceFinal('/', complySlashes(source)) // fast-glob lib wants forward-slashes
            const ignore = [node.hide, node.remove].flat().filter(Boolean).map(x => base!+x)
            const dirStream = glob.stream(base+'*', {
                dot: true,
                onlyFiles: false,
                ignore,
            })
            for await (let path of dirStream) {
                if (offset) {
                    offset--
                    continue
                }
                if (limit === list.length)
                    break
                if (path instanceof Buffer)
                    path = path.toString('utf8')
                const stats = await stat(path)
                const name = path.slice(base.length)
                list.push(statToFile(node!.rename?.[name] || name, stats))
            }
        }

        return { list }
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
    }
}

async function nodeToFile(node: VfsNode) {
    try {
        return node.source?.includes('//') ? { n:node.name }
            : node.source ? statToFile(node.name, await stat(node.source))
                : node.name ? { n: node.name + '/' }
                    : null
    }
    catch (err:any) {
        console.error('ERR', node.source, err?.code || err)
        return null
    }
}

function statToFile(name: string | undefined, stat:Stats) {
    const folder = stat.isDirectory()
    const { ctime, mtime } = stat
    return {
        n: name + (folder ? '/' : ''),
        c: ctime,
        m: Math.abs(+mtime-+ctime) < 1000 ? undefined : mtime,
        s: folder ? undefined : stat.size,
    }
}
