import Koa from 'koa'
import { getLangData } from './lang'
import { getSection } from './customHtml'
import {
    HTTP_FORBIDDEN, HTTP_MESSAGES, HTTP_NOT_FOUND, HTTP_TOO_MANY_REQUESTS, HTTP_UNAUTHORIZED, replace
} from './cross'

const declaredErrorPages = [HTTP_NOT_FOUND, HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS].map(String)

export function getErrorSections() {
    return declaredErrorPages
}

// to be used with errors whose recipient is possibly human
export async function sendErrorPage(ctx: Koa.Context, code=ctx.status) {
    ctx.type = 'text'
    ctx.set('content-disposition', '') // reset ctx.attachment (or forceDownload)
    ctx.status = code
    let msg = HTTP_MESSAGES[ctx.status] || ''
    if (!msg) return
    const lang = await getLangData(ctx)
    const trans = lang ? (Object.values(lang)[0] as any)?.translate : undefined
    msg = trans?.[msg] ?? msg
    const page = getSection(ctx.status === HTTP_UNAUTHORIZED ? 'unauthorized' : String(ctx.status))
        || SIMPLE_PAGE || ''
    if (page.includes('<'))
        ctx.type = 'html'
    ctx.body = replace(page, { MESSAGE: msg, HOME: trans?.home ?? 'home', URL: ctx.state.revProxyPath || '/' }, '$')
}

const SIMPLE_PAGE = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>$MESSAGE</title>
<style>
body{margin-top:30vh; text-align:center; font-family:sans-serif;}
a{color:#68a}
@media (prefers-color-scheme:dark){body{background:#111; color:#999;}}
</style>
</head><body>
<h1>$MESSAGE</h1>
<h2><a href="$URL">$HOME</a></h2>
</body></html>`
