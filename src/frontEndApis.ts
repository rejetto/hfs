import { vfs, VfsNode, walkNode } from './vfs'
import _ from 'lodash'
import createSSE from './sse'
import { basename } from 'path'
import { getCurrentUsername, updateAccount, verifyLogin } from './perm'
import { stat } from 'fs/promises'
import { ApiHandlers } from './apis'

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
        if (!await verifyLogin(user, password))
            return ctx.status = 401
        if (ctx.session)
            ctx.session.user = user
        return true
    },

    async logout({}, ctx) {
        if (ctx.session)
            ctx.session.user = undefined
        ctx.status = 200
        return true
    },

    async refresh_session({}, ctx) {
        return { user: ctx.session?.user }
    },

    async change_pwd({ newPassword }, ctx) {
        await updateAccount(await getCurrentUsername(ctx), account => {
            account.password = newPassword
        })
        return true
    }
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
