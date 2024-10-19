import { getCurrentUsername, setLoggedIn } from './auth'
import { HTTP_UNAUTHORIZED } from './cross-const'
import Koa from 'koa'
import { defineConfig } from './config'
import { getNodeName, hasDefaultFile, nodeIsDirectory, VfsNode, walkNode } from './vfs'
import { asyncGeneratorToReadable, Dict, filterMapGenerator, pathEncode } from './misc'
import _ from 'lodash'
import { title } from './adminApis'
import { getSection } from './customHtml'

const autoBasic = defineConfig('auto_basic', true)

export function basicWeb(ctx: Koa.Context, node: VfsNode) {
    const { get } = ctx.query
    if (get === 'login') {
        if (getCurrentUsername(ctx))
            ctx.redirect(ctx.get('referer'))
        else {
            ctx.set('WWW-Authenticate', 'Basic')
            ctx.status = HTTP_UNAUTHORIZED
        }
        return true
    }
    if (get === 'logout') {
        ctx.body = `<script>location = ${JSON.stringify(ctx.get('referer'))}</script>`
        setLoggedIn(ctx, false)
        ctx.status = HTTP_UNAUTHORIZED // not effective on firefox52, but the redirection is
        return true
    }
    const forced = get === 'basic'
    const goBasic = forced || detectBasicAgent(ctx) && get !== 'nobasic'
    if (!goBasic) return
    ctx.type = 'html'
    const force = forced ? '?get=basic' : ''
    const walker = walkNode(node, { ctx, depth: 0 })
    const stream = asyncGeneratorToReadable(filterMapGenerator(walker, async el => {
        const isFolder = await nodeIsDirectory(el)
        const name = getNodeName(el) + (isFolder ? '/' : '')
        return `<li>${a(pathEncode(name) + (isFolder && !await hasDefaultFile(el, ctx) ? force : ''), name)}\n`
    }))
    ctx.body = stream
    stream.push(`<meta name="viewport" content="width=device-width" />`)
    stream.push(`<style>body { font-size: 16pt; }</style>`)
    stream.push(`<title>${title.get()}</title><body>`)
    stream.push(getSection('basicHeader'))
    const u = getCurrentUsername(ctx)
    const links: Dict<string> = u ? { [`//LOGOUT%00:@${ctx.host}/?get=logout`]: `Logout (${u})` } : { '/?get=login': "Login" }
    stream.push(_.map(links, (v,k) => a(k, v)).join(' ') + '\n<ul>\n')
    if (ctx.state.originalPath.length > 1)
        stream.push('<li>' + a('..' + force, '..') + '\n')
    stream.on('ending', () =>
        stream.push('</ul>\n' + getSection('basicFooter')) )
    return true

    function a(href: string, label: string) {
        return `<a href='${href}'>${label}</a>`
    }

}

export function detectBasicAgent(ctx: Koa.Context) {
    const ua = ctx.get('user-agent')
    const v = autoBasic.get()
    return v && (/Mozilla\/4|WebKit\/([234]\d\d|5[012]\d|53[0123456])[. ]|Trident|Lynx|curl|Firefox\/(\d|[1234]\d)\./.test(ua)
        || _.isString(v) && ua.includes(v))
}

