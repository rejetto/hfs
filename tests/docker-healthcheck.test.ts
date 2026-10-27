import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

test('Docker healthcheck requires the bundled GUI and rejects failures', { timeout: 15000 }, async t => {
    const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
    const command = dockerfile.match(/HEALTHCHECK[^\n]*\\\n\s+CMD ([\s\S]*?)\n\n/)![1].replace(/\\\n\s*/g, ' ')
    let status = 200
    let hang = false
    const server = createServer((req, res) => {
        assert.equal(req.method, 'HEAD')
        assert.equal(req.url, '/~/frontend/index.html')
        if (hang) return
        res.writeHead(status)
        res.end()
    })
    t.after(() => { server.closeAllConnections(); server.close() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address !== 'string')
    const env = { ...process.env, HFS_PORT: String(address.port), http_proxy: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '' }
    await exec('/bin/sh', ['-c', command], { env })
    for (status of [204, 302, 401, 403, 404, 500, 503])
        await assert.rejects(exec('/bin/sh', ['-c', command], { env }))
    hang = true
    await assert.rejects(exec('/bin/sh', ['-c', command], { env }))
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await assert.rejects(exec('/bin/sh', ['-c', command], { env }))
})
