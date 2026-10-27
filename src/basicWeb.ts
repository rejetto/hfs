import { getCurrentUsername } from './auth'
import Koa from 'koa'
import { defineConfig } from './config'
import { getNodeName, getDefaultFile, hasPermission, nodeIsFolder, VfsNodeWithPath, walkNode } from './vfs'
import { asyncGeneratorToReadable, CFG, escapeHTML, filterMapGenerator, pathEncode } from './misc'
import { basicAuthRoot, getBasicAuthToken } from './basicAuth'
import _ from 'lodash'
import { title } from './adminApis'
import { getSection } from './customHtml'

const autoBasic = defineConfig<boolean|string, null|RegExp>(CFG.auto_basic, true, v => _.isString(v) ? new RegExp(v, 'i') : null)

export function basicWeb(ctx: Koa.Context, node: VfsNodeWithPath) {
    const { get } = ctx.query
    if (!shouldBeBasic(ctx)) return
    ctx.type = 'html'
    const force = get === 'basic' ? '?get=basic' : ''
    const walker = walkNode(node, { ctx, depth: 0, useCache: true })
    const stream = asyncGeneratorToReadable(filterMapGenerator(walker, async el => {
        const isFolder = nodeIsFolder(el)
        const name = getNodeName(el) + (isFolder ? '/' : '')
        const forceThis = isFolder && (el.see_without_probing || !await getDefaultFile(el, ctx)) ? force : ''
        return `<li>${a(pathEncode(name) + forceThis, name)}\n`
    }))
    ctx.body = stream
    stream.push(`<meta name="viewport" content="width=device-width" />`)
    stream.push(`<style>body { font-size: 16pt; }</style>`)
    stream.push(`<title>${title.get()}</title><body>`)
    stream.push(getSection('basicHeader'))
    const u = getCurrentUsername(ctx)
    const authRoot = escapeHTML(basicAuthRoot(ctx))
    const returnTo = escapeHTML((ctx.state.revProxyPath || '') + ctx.originalUrl)
    stream.push(u
        ? `<form method="post" action="${authRoot}?get=logout"><input type="hidden" name="csrf" value="${getBasicAuthToken(ctx)}"><input type="hidden" name="returnTo" value="${returnTo}"><button type="submit">Logout (${escapeHTML(u)})</button></form>\n`
        : `<a href="${authRoot}?get=login">Login</a>\n`)
    if (hasPermission(node, 'can_upload', ctx))
        stream.push(`<br><br><form method="post" action="?get=basic" enctype="multipart/form-data"><label>Upload files: <input type="file" name="upload" multiple required></label><button type="submit">Upload</button></form>\n`)
    stream.push('<ul>\n')
    if (ctx.state.originalPath.length > 1)
        stream.push('<li>' + a('..' + force, '..') + '\n')
    stream.on('ending', () =>
        stream.push('</ul>\n' + getSection('basicFooter')) )
    return true

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
