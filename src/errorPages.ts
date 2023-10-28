import Koa from 'koa'
import { getLangData } from './lang'
import { getSection } from './customHtml'
import { HTTP_FORBIDDEN, HTTP_MESSAGES, HTTP_NOT_FOUND } from './cross'

const declaredErrorPages = [HTTP_NOT_FOUND, HTTP_FORBIDDEN].map(String)

export function getErrorSections() {
    return declaredErrorPages
}

export async function sendErrorPage(ctx: Koa.Context, code: number) {
    ctx.status = code
    const msg = HTTP_MESSAGES[ctx.status]
    if (!msg) return
    const lang = await getLangData(ctx)
    if (!lang) return
    const trans = (Object.values(lang)[0] as any)?.translate
    ctx.body = trans?.[msg] ?? msg
    const errorPage = getSection(String(ctx.status))
    if (!errorPage) return
    if (errorPage.includes('<'))
        ctx.type = 'html'
    ctx.body = errorPage.replace('$MESSAGE', String(ctx.body))
}
