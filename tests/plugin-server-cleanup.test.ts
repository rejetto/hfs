import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { pki } from 'node-forge'

test('plugins.onServer cleans sync and async HTTP/HTTPS registrations, including after unload', { timeout: 20000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-server-cleanup-'))
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
    await mkdir(join(cwd, 'plugins/server-cleanup'), { recursive: true })
    await writeFile(join(cwd, 'plugins/server-cleanup/plugin.js'), `
exports.apiRequired = 1
exports.init = async api => {
    const record = value => api.require('fs').appendFileSync('trace', value + '\\n')
    await api.onServer(server => server) // legacy non-function return values remain valid
    const register = server => {
        const handler = (req, socket) => socket.end('HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\nConnection: close\\r\\n\\r\\nprobe')
        server.on('upgrade', handler)
        record('add:' + server.name)
        return async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
            server.removeListener('upgrade', handler)
            record('remove:' + server.name + ':' + server.listeners('upgrade').includes(handler))
            if (api.getConfig('throwCleanup') && server.name === 'http')
                throw Error('expected cleanup failure')
        }
    }
    await api.onServer(api.getConfig('asyncCallback') ? async server => {
        await new Promise(resolve => setImmediate(resolve))
        if (api.getConfig('failCallback') && server.name === 'https')
            throw Error('expected async callback failure')
        return register(server)
    } : register)
    if (api.getConfig('failInit')) throw Error('expected init failure')
    return { unload() { record('unload') } }
}
`)
    await mkdir(join(cwd, 'plugins/late-cleanup'), { recursive: true })
    await writeFile(join(cwd, 'plugins/late-cleanup/plugin.js'), `
exports.apiRequired = 1
exports.init = async api => {
    const fs = api.require('fs')
    const record = value => fs.appendFileSync('trace', value + '\\n')
    let firstHttps = true
    await api.onServer(async server => {
        if (server.name !== 'https') return
        if (firstHttps) { firstHttps = false; return }
        await new Promise(resolve => {
            const watcher = fs.watch('.', () => {
                if (fs.existsSync('release')) { watcher.close(); resolve() }
            })
            record('pending')
        })
        const handler = () => {}
        server.on('upgrade', handler)
        record('late-add')
        return async () => {
            await new Promise(resolve => setImmediate(resolve))
            server.removeListener('upgrade', handler)
            record('late-remove:' + server.listeners('upgrade').includes(handler))
            throw Error('expected late cleanup failure')
        }
    })
    return { unload() { record('late-unload') } }
}
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: 0, listen_interface: '127.0.0.1', force_https: false,
        cert: 'cert.pem', private_key: 'key.pem', enable_plugins: [],
        open_browser_at_start: false, log: '', error_log: '',
    }))
    const child = spawn(process.execPath, [resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    t.after(async () => {
        child.kill()
        await stopped
        await rm(cwd, { recursive: true, force: true })
    })
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    let http = '', https = ''
    for (let i = 0; i < 100; i++) {
        http = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        https = /Serving on (https:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        if (http && https) break
        assert.equal(child.exitCode, null, output)
        await delay(100)
    }
    assert.ok(http && https, output)
    // dist runs backend tests before building the GUI assets
    assert.equal(await probe(https + '/~/api/get_status'), 200)
    // listening can precede the asynchronous scan of installed plugins
    for (let i = 0; i < 50; i++) {
        const { list } = await fetch(http + '/~/api/get_plugins').then(r => r.json()) as { list: { id: string }[] }
        if (list.some(p => p.id === 'server-cleanup')) break
        await delay(100)
    }
    await api('start_plugin', { id: 'server-cleanup' })
    assert.deepEqual(await trace(), ['add:http', 'add:https'])
    await probe(http, true)
    await probe(https, true)

    // create another real HTTPS server after subscription, exercising the listening-event path
    await api('set_config', { values: { https_port: -1 } })
    await api('set_config', { values: { https_port: 0 } })
    for (let i = 0; i < 50 && (await trace()).length < 3; i++) await delay(100)
    assert.deepEqual(await trace(), ['add:http', 'add:https', 'add:https'])
    await api('stop_plugin', { id: 'server-cleanup' })
    const stoppedTrace = await trace()
    assert.deepEqual(stoppedTrace.slice(3, -1).sort(), ['remove:http:false', 'remove:https:false', 'remove:https:false'])
    assert.equal(stoppedTrace.at(-1), 'unload')

    await writeFile(join(cwd, 'trace'), '')
    await api('set_plugin', { id: 'server-cleanup', config: { asyncCallback: true } })
    await api('start_plugin', { id: 'server-cleanup' })
    assert.deepEqual(await trace(), ['add:http', 'add:https'])
    await probe(http, true)
    const status = await fetch(http + '/~/api/get_status').then(r => r.json()) as { https: { port: number } }
    https = 'https://127.0.0.1:' + status.https.port
    await probe(https, true)
    await api('stop_plugin', { id: 'server-cleanup' })
    assert.deepEqual(await trace(), ['add:http', 'add:https', 'remove:http:false', 'remove:https:false', 'unload'])

    await writeFile(join(cwd, 'trace'), '')
    await api('set_plugin', { id: 'server-cleanup', config: { throwCleanup: true } })
    await api('start_plugin', { id: 'server-cleanup' })
    await api('stop_plugin', { id: 'server-cleanup' })
    assert.deepEqual(await trace(), ['add:http', 'add:https', 'remove:http:false', 'remove:https:false', 'unload'])
    assert.match(output, /expected cleanup failure/)

    await writeFile(join(cwd, 'trace'), '')
    await api('set_plugin', { id: 'server-cleanup', config: { throwCleanup: false, failInit: true } })
    await api('start_plugin', { id: 'server-cleanup' }, 500)
    assert.deepEqual(await trace(), ['add:http', 'add:https', 'remove:http:false', 'remove:https:false'])

    await writeFile(join(cwd, 'trace'), '')
    await api('set_plugin', { id: 'server-cleanup', config: { failInit: false, failCallback: true } })
    await api('start_plugin', { id: 'server-cleanup' }, 500)
    assert.deepEqual(await trace(), ['add:http', 'remove:http:false'])
    assert.match(output, /expected async callback failure/)
    await api('set_plugin', { id: 'server-cleanup', enabled: false })

    await writeFile(join(cwd, 'trace'), '')
    await api('start_plugin', { id: 'late-cleanup' })
    await api('set_config', { values: { https_port: -1 } })
    await api('set_config', { values: { https_port: 0 } })
    for (let i = 0; i < 50 && !(await trace()).includes('pending'); i++) await delay(100)
    assert.deepEqual(await trace(), ['pending'])
    // release the callback only after unload has completed, so the race is deterministic
    await api('stop_plugin', { id: 'late-cleanup' })
    assert.deepEqual(await trace(), ['pending', 'late-unload'])
    await writeFile(join(cwd, 'release'), '')
    for (let i = 0; i < 50 && !(await trace()).includes('late-remove:false'); i++) await delay(100)
    assert.deepEqual(await trace(), ['pending', 'late-unload', 'late-add', 'late-remove:false'])
    assert.match(output, /expected late cleanup failure/)
    assert.equal((await fetch(http + '/~/api/get_status')).status, 200)

    async function api(name: string, body: object, status = 200) {
        const response = await fetch(http + '/~/api/' + name, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
        })
        assert.equal(response.status, status, await response.text())
    }

    async function trace() {
        return (await readFile(join(cwd, 'trace'), 'utf8')).trim().split('\n').filter(Boolean)
    }

    function probe(url: string, upgrade = false) {
        return new Promise<number | undefined>((resolve, reject) => {
            // this isolated test server uses the self-signed certificate generated above
            const get = url.startsWith('https:') ? httpsGet : httpGet
            const req = get(url, { rejectUnauthorized: false,
                headers: upgrade ? { Connection: 'Upgrade', Upgrade: 'websocket' } : {},
            }, res => {
                let body = ''
                res.on('data', chunk => body += chunk)
                res.on('end', () => {
                    try {
                        if (upgrade) assert.equal(body, 'probe')
                        resolve(res.statusCode)
                    }
                    catch (error) { reject(error) }
                })
            })
            req.on('error', reject)
            req.setTimeout(3000, () => req.destroy(Error('HTTPS probe timed out')))
        })
    }
})
