import Koa from 'koa'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex, Readable, Writable } from 'node:stream'
import { WebSocketServer } from 'ws'

const upgrades = new WeakMap<IncomingMessage, { head: Buffer, response: ServerResponse }>()
// clients do not send subscription data, so do not buffer large incoming messages
const server = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: true })
server.on('headers', (headers, req) => {
    // session renewal cookies must accompany the upgrade after the middleware has finished
    const cookies = upgrades.get(req)?.response.getHeader('set-cookie')
    for (const cookie of cookies ? [cookies].flat() : [])
        headers.push('Set-Cookie: ' + cookie)
})

export function apiWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer,
    callback: (req: IncomingMessage, res: ServerResponse) => void) {
    // Node removes its HTTP socket error handler before our asynchronous middleware runs
    socket.on('error', () => socket.destroy())
    const response = new ServerResponse(req)
    response.assignSocket(req.socket)
    response.shouldKeepAlive = false
    response.once('finish', () => socket.end())
    upgrades.set(req, { head, response })
    callback(req, response)
}

export const apiWebSocketMiddleware: Koa.Middleware = async (ctx, next) => {
    const upgrade = upgrades.get(ctx.req)
    if (!upgrade)
        return next()
    // cookies can accompany cross-site upgrades; check before any authentication or API side effects
    if (ctx.get('origin') !== ctx.URL.origin) {
        ctx.status = 403
        ctx.body = "WebSocket origin must match the request origin"
        return
    }
    // browsers omit Referer on WebSockets; roots still need the initiating page path
    const pagePath = ctx.query._hfs_page
    if (typeof pagePath === 'string') {
        ctx.req.headers.referer = ctx.URL.origin + pagePath
        delete ctx.query._hfs_page
    }
    ctx.req.headers.accept = 'text/event-stream'
    ctx.compress = false
    await next()
    const body = ctx.body
    if (ctx.status !== 200 || !(body instanceof Readable))
        return
    const { socket } = ctx.req
    if (socket.destroyed) {
        body.destroy()
        return
    }
    ctx.respond = false
    ctx.res.detachSocket(socket)
    // detached responses no longer receive Node's automatic socket-close notification
    socket.once('close', () => ctx.res.emit('close'))
    server.handleUpgrade(ctx.req, socket, upgrade.head, ws => {
        const output = new Writable({
            objectMode: true,
            write(chunk, _encoding, done) { ws.send(chunk, { binary: false }, done) },
            final(done) { ws.close(1000); done() },
        })
        ws.on('error', () => ws.terminate())
        ws.on('message', () => ws.close(1008)) // subscriptions are defined by the URL; client messages have no API meaning
        ws.once('close', () => {
            body.destroy()
            output.destroy()
        })
        body.on('error', error => {
            ctx.app.emit('error', error, ctx)
            ws.terminate()
        })
        output.on('error', () => ws.terminate())
        body.pipe(output)
    })
}

export function isApiWebSocket(ctx: Koa.Context) {
    return upgrades.has(ctx.req)
}
