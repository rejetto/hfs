import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { pki } from 'node-forge'
import { LIST } from '../src/cross'

test('HFS WebSocket APIs retain session authorization, HTTP snapshots and SSE compatibility', { timeout: 15000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-websocket-'))
    const keys = pki.rsa.generateKeyPair(2048)
    const cert = pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 1)
    cert.setSubject([{ name: 'commonName', value: 'localhost' }])
    cert.setIssuer(cert.subject.attributes)
    cert.sign(keys.privateKey)
    await writeFile(join(cwd, 'cert.pem'), pki.certificateToPem(cert))
    await writeFile(join(cwd, 'key.pem'), pki.privateKeyToPem(keys.privateKey))
    await mkdir(join(cwd, 'plugins/lifecycle-probe'), { recursive: true })
    await writeFile(join(cwd, 'plugins/lifecycle-probe/plugin.js'), `
exports.apiRequired = 1
exports.customRest = {
    failure() {
        const stream = new (require('stream').Readable)({ objectMode: true, read() {} })
        setTimeout(() => stream.destroy(new Error('expected source failure')), 20)
        return stream
    },
    async lifecycle(_, ctx) {
        const closed = require('events').once(ctx.res, 'close')
        ctx.req.socket.destroy()
        await closed
        const stream = new (require('stream').Readable)({ objectMode: true, read() {} })
        stream.once('close', () => require('fs').writeFileSync('stream-released', 'yes'))
        return stream
    }
}
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: 0, force_https: false, cert: 'cert.pem', private_key: 'key.pem', listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, enable_plugins: ['lifecycle-probe'], log: '', error_log: '',
        accounts: { admin: { password: 'test-secret', admin: true } },
        vfs: { children: [{ name: 'è漢🙂' }] },
    }))
    const child = spawn(process.execPath, [resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    const sockets: WebSocket[] = []
    t.after(async () => {
        for (const ws of sockets) ws.terminate()
        child.kill()
        await stopped
        await rm(cwd, { recursive: true, force: true, maxRetries: 5 })
    })
    let origin = ''
    for (let i = 0; i < 150 && !origin; i++) {
        origin = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        await delay(50)
    }
    assert(origin, output)
    const login = await fetch(origin + '/~/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hfs-anti-csrf': '1' },
        body: JSON.stringify({ username: 'admin', password: 'test-secret' }),
    })
    assert.equal(login.status, 200, await login.text())
    const cookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
    assert(cookie)

    const denied = subscribe('get_plugins')
    assert((await denied.first).some((x: unknown[]) => x[0] === LIST.error && x[1] === 401))
    const allowed = subscribe('get_plugins', cookie)
    assert(!(await allowed.first).some((x: unknown[]) => x[0] === LIST.error))

    const evil = new WebSocket(origin.replace('http:', 'ws:') + '/~/api/get_plugins', {
        origin: 'http://evil.example', headers: { Cookie: cookie },
    })
    sockets.push(evil)
    evil.on('error', () => {})
    const [, response] = await once(evil, 'unexpected-response')
    assert.equal(response.statusCode, 403)
    response.resume()
    evil.terminate()

    const list = subscribe('get_file_list')
    const listClosed = once(list.ws, 'close')
    assert((await list.first).some((x: unknown[]) => x[0] === '+' && (x[1] as { n: string }).n === 'è漢🙂/'))
    assert.equal((await listClosed)[0], 1000)
    const subscriptions = Array.from({ length: 8 }, (_, i) => subscribe('get_notifications?channel=' + i))
    await Promise.all(subscriptions.map(x => x.first))
    const snapshot = await fetch(origin + '/~/api/get_file_list').then(r => r.json()) as { list: unknown[] }
    assert.equal(snapshot.list.length, 1)
    const status = await fetch(origin + '/~/api/get_status', { headers: { Cookie: cookie } }).then(r => r.json()) as { https: { port: number } }
    const secureOrigin = 'https://127.0.0.1:' + status.https.port
    const secure = new WebSocket(secureOrigin.replace('https:', 'wss:') + '/~/api/get_file_list', {
        origin: secureOrigin, rejectUnauthorized: false,
    })
    sockets.push(secure)
    const secureClosed = once(secure, 'close')
    assert((await once(secure, 'message'))[0].toString().includes('è漢🙂'))
    assert.equal((await secureClosed)[0], 1000)
    const sse = await fetch(origin + '/~/api/get_file_list', { headers: { Accept: 'text/event-stream' } })
    assert.match(sse.headers.get('content-type')!, /text\/event-stream/)
    assert.match(await sse.text(), /data:.*è漢🙂/)
    const roots = await fetch(origin + '/~/api/set_config', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'x-hfs-anti-csrf': '1' },
        body: JSON.stringify({ values: { roots: { '*': '/è漢🙂' }, force_address: true } }),
    })
    assert.equal(roots.status, 200)
    const adminRoot = subscribe('get_file_list?uri=/&admin=true&_hfs_page=' + encodeURIComponent('/~/admin/'), cookie)
    assert((await adminRoot.first).some((x: unknown[]) => x[0] === '+' && (x[1] as { n: string }).n === 'è漢🙂/'))
    const forgedAdminPage = subscribe('get_file_list?uri=/&admin=true&_hfs_page=' + encodeURIComponent('/~/admin/'))
    const forged = await forgedAdminPage.first
    assert(!forged.some((x: unknown[]) => x[0] === '+'), 'page metadata must not grant admin access: ' + JSON.stringify(forged))
    const failure = new WebSocket(origin.replace('http:', 'ws:') + '/~/api/_failure', {
        origin, headers: { 'x-hfs-anti-csrf': '1' },
    })
    sockets.push(failure)
    const failedClosed = once(failure, 'close', { signal: AbortSignal.timeout(2000) })
    assert.equal((await failedClosed)[0], 1006, 'source errors must close the subscription')
    const interrupted = new WebSocket(origin.replace('http:', 'ws:') + '/~/api/_lifecycle', {
        origin, headers: { 'x-hfs-anti-csrf': '1' },
    })
    sockets.push(interrupted)
    interrupted.on('error', () => {})
    await new Promise<void>(resolve => interrupted.once('close', () => resolve()))
    let released = ''
    for (let i = 0; i < 50 && !released; i++) {
        released = await readFile(join(cwd, 'stream-released'), 'utf8').catch(() => '')
        if (!released) await delay(20)
    }
    assert.equal(released, 'yes', 'a stream returned after disconnection must still be destroyed')
    assert.match(output, /Server error[^\n]*expected source failure/)
    assert(!/Server error|Uncaught/.test(output.replace(/Server error[^\n]*expected source failure/g, '')), output)

    function subscribe(command: string, cookie='') {
        const ws = new WebSocket(origin.replace('http:', 'ws:') + '/~/api/' + command, { origin, headers: { Cookie: cookie } })
        sockets.push(ws)
        const first = once(ws, 'message').then(([data]) => JSON.parse(String(data)) as unknown[][])
        return { ws, first }
    }
})
