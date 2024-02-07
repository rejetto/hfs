import Koa from 'koa'
import { getLangData } from './lang'
import { getSection } from './customHtml'
import { HTTP_FORBIDDEN, HTTP_MESSAGES, HTTP_NOT_FOUND, HTTP_TOO_MANY_REQUESTS, HTTP_UNAUTHORIZED } from './cross'

const declaredErrorPages = [HTTP_NOT_FOUND, HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS].map(String)

export function getErrorSections() {
    return declaredErrorPages
}

// to be used with errors whose recipient is possibly human
export async function sendErrorPage(ctx: Koa.Context, code=ctx.status) {
    ctx.type = 'text'
    ctx.set('content-disposition', '') // reset ctx.attachment
    ctx.status = code
    const msg = HTTP_MESSAGES[ctx.status]
    if (!msg) return
    const lang = await getLangData(ctx)
    if (!lang) return
    const trans = (Object.values(lang)[0] as any)?.translate
    ctx.body = trans?.[msg] ?? msg
    const errorPage = getSection(ctx.status === HTTP_UNAUTHORIZED ? 'unauthorized' : String(ctx.status))
    if (!errorPage) return
    if (errorPage.includes('<'))
        ctx.type = 'html'
    ctx.body = errorPage.replace('$MESSAGE', String(ctx.body))
}
