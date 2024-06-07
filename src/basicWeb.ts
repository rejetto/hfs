import { getCurrentUsername, setLoggedIn } from './auth'
import { HTTP_UNAUTHORIZED } from './cross-const'
import Koa from 'koa'
import { defineConfig } from './config'
import { getNodeName, nodeIsDirectory, VfsNode, walkNode } from './vfs'
import { asyncGeneratorToReadable, Dict, filterMapGenerator, pathEncode } from './misc'
import _ from 'lodash'
import { title } from './adminApis'
import { getSection } from './customHtml'

const autoBasic = defineConfig('auto_basic', true)

export function basicWeb(ctx: Koa.Context, node: VfsNode) {
    const { get } = ctx.query
    if (get === 'login') {
        if (getCurrentUsername(ctx))
            ctx.redirect('?')
        else {
            ctx.set('WWW-Authenticate', 'Basic')
            ctx.status = HTTP_UNAUTHORIZED
        }
        return true
    }
    if (get === 'logout') {
        ctx.body = `<script>location = '?'</script>`
        setLoggedIn(ctx, false)
        ctx.status = HTTP_UNAUTHORIZED
        return true
    }
    const forced = get === 'basic'
    if (forced || detectBasicAgent(ctx)) {
        ctx.type = 'html'
        const force = forced ? '?get=basic' : ''
        const walker = walkNode(node, { ctx, depth: 0 })
        const stream = asyncGeneratorToReadable(filterMapGenerator(walker, async el => {
            const isFolder = await nodeIsDirectory(el)
            const name = getNodeName(el) + (isFolder ? '/' : '')
            return `<li>${a(pathEncode(name) + (isFolder ? force : ''), name)}\n`
        }))
        ctx.body = stream
        stream.push(`<title>${title.get()}</title><body>`)
        stream.push(getSection('basicHeader'))
        const links: Dict<string> = getCurrentUsername(ctx) ? { '?get=logout': "Logout" } : { '?get=login': "Login" }
        stream.push(_.map(links, (v,k) => a(k, v)).join(' ') + '\n<ul>\n')
        if (ctx.state.originalPath.length > 1)
            stream.push('<li>' + a('..' + force, '..') + '\n')
        stream.push('</ul>\n')
        stream.push(getSection('basicFooter'))
        return true
    }

    function a(href: string, label: string) {
        return `<a href='${href}'>${label}</a>`
    }

}

export function detectBasicAgent(ctx: Koa.Context) {
    const ua = ctx.get('user-agent')
    const v = autoBasic.get()
    return v && (/Mozilla\/4|WebKit\/([234]\d\d|5[012]\d|53[0123456])[. ]|Trident|Lynx|curl|Firefox\/(\d|[123]\d)\./.test(ua)
        || _.isString(v) && ua.includes(v))
}

