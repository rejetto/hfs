import { getCurrentUsername, setLoggedIn } from './auth'
import { BASIC_AUTHENTICATE_HEADER, HTTP_UNAUTHORIZED } from './cross-const'
import Koa from 'koa'
import { Readable } from 'stream'
import { defineConfig } from './config'
import { getNodeName, getDefaultFile, hasPermission, nodeIsFolder, VfsNodeWithPath, walkNode } from './vfs'
import { CFG, Dict, escapeHTML, pathEncode, try_ } from './misc'
import _ from 'lodash'
import { title } from './adminApis'
import { getSection } from './customHtml'

const autoBasic = defineConfig<boolean|string, null|RegExp>(CFG.auto_basic, true, v => _.isString(v) ? new RegExp(v, 'i') : null)

export async function basicWeb(ctx: Koa.Context, node: VfsNodeWithPath) {
    const { get } = ctx.query
    if (get === 'login') {
        if (getCurrentUsername(ctx))
            ctx.redirect(localReferer())
        else {
            ctx.set('WWW-Authenticate', BASIC_AUTHENTICATE_HEADER)
            ctx.status = HTTP_UNAUTHORIZED
        }
        return true
    }
    if (get === 'logout') {
        await setLoggedIn(ctx, false)
        // browsers can retain cached Basic credentials after a 401
        ctx.session = { basicLoggedOut: true } as Koa.Context['session']
        // refresh lets legacy browsers return to the folder while retaining the 401 for HTTP Basic logout
        ctx.set('Refresh', '0;url=' + localReferer())
        ctx.body = "Logged out"
        ctx.status = HTTP_UNAUTHORIZED
        return true
    }
    if (!shouldBeBasic(ctx)) return
    ctx.type = 'html'
    const force = get === 'basic' ? '?get=basic' : ''
    ctx.body = Readable.from((async function* () {
        yield `<meta name="viewport" content="width=device-width" />`
        yield `<style>body { font-size: 16pt; }</style>`
        yield `<title>${title.get()}</title><body>`
        yield getSection('basicHeader')
        const u = getCurrentUsername(ctx)
        const links: Dict<string> = u ? { [`//LOGOUT%00:@${ctx.host}/?get=logout`]: `Logout (${u})` } : { '/?get=login': "Login" }
        yield _.map(links, (v,k) => a(k, v)).join(' ') + '\n'
        if (hasPermission(node, 'can_upload', ctx))
            yield `<br><br><form method="post" action="?get=basic" enctype="multipart/form-data"><label>Upload files: <input type="file" name="upload" multiple required></label><button type="submit">Upload</button></form>\n`
        yield '<ul>\n'
        if (ctx.state.originalPath.length > 1)
            yield '<li>' + a('..' + force, '..') + '\n'
        for await (const el of walkNode(node, { ctx, depth: 0, useCache: true })) {
            const isFolder = nodeIsFolder(el)
            const name = getNodeName(el) + (isFolder ? '/' : '')
            const forceThis = isFolder && (el.see_without_probing || !await getDefaultFile(el, ctx)) ? force : ''
            yield `<li>${a(pathEncode(name) + forceThis, name)}\n`
        }
        yield '</ul>\n' + getSection('basicFooter')
    })())
    return true

    function localReferer() {
        const base = ctx.URL
        const referer = ctx.get('referer')
        const url = referer && try_(() => new URL(referer, base))
        // an absolute URL keeps double-slash paths local and drops the logout link's temporary Basic credentials
        return url && (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === base.origin
            ? url.origin + url.pathname + url.search + url.hash : '/'
    }

    function a(href: string, label: string) {
        return `<a href='${href}'>${escapeHTML(label)}</a>`
    }

}

export function shouldBeBasic(ctx: Koa.Context) {
    const { get } = ctx.query
    return get === 'basic' || detectBasicAgent(ctx) && get !== 'nobasic'
}

function detectBasicAgent(ctx: Koa.Context) {
    const ua = ctx.get('user-agent')
    return autoBasic.get() && /^$|Mozilla\/4|WebKit\/([234]\d\d|5[012]\d|53[0123456])[. ]|Trident|Lynx|curl|Firefox\/(\d|[1234]\d)\./.test(ua)
        || autoBasic.compiled()?.test(ua)
}
