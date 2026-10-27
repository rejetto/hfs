import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import Koa from 'koa'
import WebSocket from 'ws'
import { apiWebSocketMiddleware, apiWebSocketUpgrade } from '../src/apiWebSocket'
import { ThrottledStream, ThrottleGroup } from '../src/ThrottledStream'

// exercise a real handshake and throttled stream so cookies, framing and disconnect cleanup share one lifecycle
test('WebSocket subscriptions validate Origin before handlers and preserve cookies, messages and cleanup', { timeout: 10000 }, async t => {
    let handled = 0, cleaned = 0
    let lastStream: Readable
    const app = new Koa()
    app.on('error', error => assert.equal(error.message, 'connection reset during authentication'))
    app.proxy = true
    let finishAuthentication!: () => void
    app.use(apiWebSocketMiddleware).use(async ctx => {
        if (ctx.path === '/slow') {
            await new Promise<void>(resolve => { finishAuthentication = resolve })
            ctx.status = 401
            return
        }
        handled++
        ctx.set('Set-Cookie', ['session=renewed; HttpOnly', 'signature=renewed; HttpOnly'])
        if (ctx.path === '/denied') {
            ctx.status = 401
            return
        }
        const message = Buffer.from(JSON.stringify({ cookie: ctx.get('cookie'), text: 'è漢🙂'.repeat(30) }))
        const stream = lastStream = new Readable({ objectMode: true, read() {} })
        const throttled = new ThrottledStream(new ThrottleGroup(1), undefined, true)
        stream.pipe(throttled)
        ctx.body = throttled
        ctx.res.on('close', () => { cleaned++; stream.destroy() })
        stream.push(message)
        if (ctx.path === '/finite') stream.push(null)
    })
    const callback = app.callback()
    const server = createServer(callback)
    server.on('upgrade', (req, socket, head) => apiWebSocketUpgrade(req, socket, head, callback))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    const sockets: WebSocket[] = []
    t.after(async () => {
        for (const ws of sockets) ws.terminate()
        await new Promise(resolve => server.close(resolve))
    })
    for (const badOrigin of [undefined, 'null', 'https://evil.example', origin.replace('http:', 'https:'), origin + '/', origin.replace(/:\d+$/, ':1')]) {
        const ws = open('/live', badOrigin)
        const [, response] = await once(ws, 'unexpected-response')
        assert.equal(response.statusCode, 403)
        response.resume()
        ws.terminate()
    }
    assert.equal(handled, 0, 'rejected origins must never reach authentication or API handlers')
    const denied = open('/denied', origin)
    const [, response] = await once(denied, 'unexpected-response')
    assert.equal(response.statusCode, 401)
    response.resume()
    denied.terminate()

    const finite = open('/finite', origin)
    const headers = once(finite, 'upgrade')
    const message = once(finite, 'message')
    const closed = once(finite, 'close')
    assert.deepEqual((await headers)[0].headers['set-cookie'], ['session=renewed; HttpOnly', 'signature=renewed; HttpOnly'])
    const [data, binary] = await message
    assert.equal(binary, false)
    assert.equal(finite.extensions, 'permessage-deflate')
    assert.deepEqual(JSON.parse(String(data)), { cookie: 'session=logged-in', text: 'è漢🙂'.repeat(30) })
    assert.equal((await closed)[0], 1000)

    const live = open('/live', origin)
    await once(live, 'message')
    const cleanedBefore = cleaned
    const liveClosed = once(live, 'close')
    const cleanup = once(lastStream!, 'close')
    live.close()
    await liveClosed
    await cleanup
    assert.equal(cleaned, cleanedBefore + 1)

    const unexpected = open('/live', origin)
    await once(unexpected, 'message')
    const unexpectedClosed = once(unexpected, 'close')
    unexpected.send('client messages cannot invoke APIs')
    assert.equal((await unexpectedClosed)[0], 1008)

    const oversized = open('/live', origin)
    await once(oversized, 'message')
    const oversizedClosed = once(oversized, 'close')
    oversized.send('x'.repeat(1025))
    assert.notEqual((await oversizedClosed)[0], 1000)

    const proxied = open('/finite', 'https://files.example:8443', {
        'X-Forwarded-Host': 'files.example:8443', 'X-Forwarded-Proto': 'https',
    })
    assert.equal((await once(proxied, 'close'))[0], 1000)

    app.proxy = false
    const spoofed = open('/finite', 'https://files.example:8443', {
        'X-Forwarded-Host': 'files.example:8443', 'X-Forwarded-Proto': 'https',
    })
    const [, rejected] = await once(spoofed, 'unexpected-response')
    assert.equal(rejected.statusCode, 403)
    rejected.resume()
    spoofed.terminate()

    const upgrading = once(server, 'upgrade')
    const interrupted = open('/slow', origin)
    const interruptedClosed = new Promise<void>(resolve => interrupted.once('close', () => resolve()))
    const [, socket] = await upgrading
    assert.doesNotThrow(() => socket.emit('error', new Error('connection reset during authentication')))
    finishAuthentication()
    await interruptedClosed

    function open(path: string, origin: string | undefined, extraHeaders={}) {
        const ws = new WebSocket(originUrl(path), {
            origin, headers: { Cookie: 'session=logged-in', ...extraHeaders },
        })
        ws.on('error', () => {}) // rejected handshake sockets are deliberately terminated by the test
        sockets.push(ws)
        return ws
    }
    function originUrl(path: string) { return origin.replace('http:', 'ws:') + path }
})
