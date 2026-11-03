import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { pki } from 'node-forge'

test('plugins clean callbacks and public routes after asynchronous unload', { timeout: 45000 }, async t => {
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
    await api.openDb('cleanup')
    const assert = api.require('node:assert/strict')
    const metadata = async ctx => {
        await Promise.resolve()
        ctx.type = 'xml'
        ctx.body = '<device>public</device>'
    }
    for (const name of ['../api/get_status', '/description.xml', '.', 'a/b', 'a?b', 'a%2fb'])
        assert.throws(() => api.registerPublicRoute(name, metadata))
    const off = api.registerPublicRoute('description.xml', metadata)
    assert.throws(() => api.registerPublicRoute('description.xml', metadata))
    off()
    api.registerPublicRoute('description.xml', metadata)
    off() // an old unregister must not remove the new registration, even with the same handler
    api.registerPublicRoute('error.xml', () => { throw Error('expected public route failure') })
    api.registerPublicRoute('status.xml', ctx => { api.setError('expected plugin status'); ctx.body = 'ok' })
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
    return { async unload() {
        if (api.getConfig('holdUnload')) {
            const fs = api.require('fs')
            api.setError('expected plugin unload status')
            await new Promise(resolve => {
                const watcher = fs.watch('.', () => {
                    if (fs.existsSync('release-stop')) { watcher.close(); resolve() }
                })
                record('unload-pending')
            })
        }
        else await new Promise(resolve => setTimeout(resolve, 100))
        record('unload')
    } }
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
    await mkdir(join(cwd, 'plugins/racing-cleanup'), { recursive: true })
    await writeFile(join(cwd, 'plugins/racing-cleanup/plugin.js'), `
exports.apiRequired = 1
exports.init = api => {
    const fs = api.require('fs')
    const generation = fs.existsSync('generation') ? Number(fs.readFileSync('generation')) + 1 : 1
    fs.writeFileSync('generation', String(generation))
    const record = value => fs.appendFileSync('trace', value + '\\n')
    api.registerPublicRoute('description.xml', ctx => { ctx.body = String(generation) })
    record('race-start:' + generation)
    return { async unload() {
        record('race-stopping:' + generation)
        if (generation === 1) {
            await new Promise(resolve => {
                const watcher = fs.watch('.', () => {
                    if (fs.existsSync('release-race')) { watcher.close(); resolve() }
                })
            })
        }
        record('race-stopped:' + generation)
    } }
}
`)
    const cacheReload = join(cwd, 'cache-source')
    await mkdir(cacheReload, { recursive: true })
    await symlink(cacheReload, join(cwd, 'plugins/cache-reload'), 'junction')
    for (const folder of ['nested', 'public', 'storage'])
        await mkdir(join(cacheReload, folder))
    await writeFile(join(cacheReload, 'nested/late.cjs'), `module.exports = 'late-first'`)
    await writeFile(join(cacheReload, 'nested/data.json'), `"data-first"`)
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'first'`)
    await writeFile(join(cacheReload, 'shared.js'), `module.exports = { starts: 0 }`)
    await writeFile(join(cacheReload, 'plugin.js'), `
require('./value')
exports.apiRequired = 1
exports.init = api => {
    const value = require('./value')
    const shared = require('./shared')
    shared.starts++
    api.registerPublicRoute('value', ctx => { ctx.body = value })
    api.registerPublicRoute('shared', ctx => { ctx.body = String(shared.starts) })
    api.registerPublicRoute('late', ctx => { ctx.body = require('./nested/late.cjs') })
    api.registerPublicRoute('data', ctx => { ctx.body = require('./nested/data.json') })
}
`)
    await mkdir(join(cwd, 'plugins/cache-observer'), { recursive: true })
    await writeFile(join(cwd, 'plugins/cache-observer/plugin.js'), `
exports.apiRequired = 1
exports.init = api => {
    const shared = require('../cache-reload/shared')
    api.registerPublicRoute('shared', ctx => { ctx.body = String(shared.starts) })
}
`)
    const reloadFolder = join(cwd, 'plugins/reload-race')
    const reloadSource = `
exports.apiRequired = 1
exports.init = api => {
    const value = require('./helper')
    api.registerPublicRoute('value', ctx => { ctx.body = value })
}
`
    await mkdir(reloadFolder)
    await writeFile(join(reloadFolder, 'plugin.js'), reloadSource)
    await writeFile(join(reloadFolder, 'helper.js'), 'module.exports = "original"')
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: 0, listen_interface: '127.0.0.1', force_https: false,
        cert: 'cert.pem', private_key: 'key.pem', enable_plugins: [],
        open_browser_at_start: false, log: 'public-access.log', error_log: 'public-error.log', dont_log_net: '',
    }))
    const child = spawn(process.execPath, [resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    t.after(async () => {
        // release a blocked unload if an earlier assertion failed
        await writeFile(join(cwd, 'release-stop'), '')
        child.kill()
        await stopped
        // Windows can retain file handles briefly after the child exits
        await rm(cwd, { recursive: true, force: true, maxRetries: 5 })
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
    await api('start_plugin', { id: 'cache-reload' })
    const cacheRoute = http + '/~/plugins/cache-reload/value'
    assert.equal(await fetch(cacheRoute).then(r => r.text()), 'first')
    await api('start_plugin', { id: 'cache-observer' })
    const observerRoute = http + '/~/plugins/cache-observer/shared'
    assert.equal(await fetch(observerRoute).then(r => r.text()), '1')
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'second'`)
    await api('stop_plugin', { id: 'cache-reload' })
    await api('start_plugin', { id: 'cache-reload' })
    assert.equal(await fetch(cacheRoute).then(r => r.text()), 'second')
    assert.equal(await fetch(http + '/~/plugins/cache-reload/shared').then(r => r.text()), '2',
        'restarting a plugin must preserve modules still used by another plugin')
    assert.equal(await fetch(observerRoute).then(r => r.text()), '2',
        'both plugins must keep the same shared module instance')
    const reloadBase = http + '/~/plugins/cache-reload/'
    assert.equal(await fetch(reloadBase + 'late').then(r => r.text()), 'late-first')
    assert.equal(await fetch(reloadBase + 'data').then(r => r.text()), 'data-first')
    await Promise.all([
        writeFile(join(cacheReload, 'value.js'), `module.exports = 'third'`),
        writeFile(join(cacheReload, 'nested/late.cjs'), `module.exports = 'late-second'`),
        writeFile(join(cacheReload, 'nested/data.json'), `"data-second"`),
        readFile(join(cacheReload, 'plugin.js'), 'utf8').then(source => writeFile(join(cacheReload, 'plugin.js'), source + '\n// changed')),
    ])
    for (let i = 0; i < 100; i++) {
        if (await fetch(cacheRoute).then(r => r.text()) === 'third') break
        await delay(50)
    }
    assert.equal(await fetch(cacheRoute).then(r => r.text()), 'third', 'helper edits must reload symlinked plugins automatically')
    assert.equal(await fetch(reloadBase + 'late').then(r => r.text()), 'late-second', 'watch helpers first required during requests')
    assert.equal(await fetch(reloadBase + 'data').then(r => r.text()), 'data-second')
    await delay(1200)
    assert.equal(await fetch(observerRoute).then(r => r.text()), '3', 'batch entrypoint and helper edits into one reload')
    await writeFile(join(cacheReload, 'nested/late.tmp'), `module.exports = 'late-third'`)
    await rename(join(cacheReload, 'nested/late.tmp'), join(cacheReload, 'nested/late.cjs'))
    for (let i = 0; i < 100; i++) {
        if (await fetch(reloadBase + 'late').then(r => r.text()) === 'late-third') break
        await delay(50)
    }
    assert.equal(await fetch(reloadBase + 'late').then(r => r.text()), 'late-third', 'an atomic helper-only save must reload without touching plugin.js')
    await writeFile(join(cacheReload, 'public/asset.js'), 'ignored')
    await writeFile(join(cacheReload, 'storage/data.json'), '{}')
    await writeFile(join(cacheReload, 'README.md'), 'ignored')
    await delay(2000)
    assert.equal(await fetch(observerRoute).then(r => r.text()), '4', 'ignore assets and runtime data')
    await mkdir(join(cacheReload, 'nested/created-later'))
    await writeFile(join(cacheReload, 'nested/created-later/helper.js'), 'module.exports = true')
    for (let i = 0; i < 100; i++) {
        if (await fetch(observerRoute).then(r => r.text()) === '5') break
        await delay(50)
    }
    assert.equal(await fetch(observerRoute).then(r => r.text()), '5', 'watch subfolders created after the watcher starts')
    await writeFile(join(cacheReload, 'value.js'), 'module.exports = ;')
    await delay(2000)
    assert.equal((await fetch(cacheRoute)).status, 404, 'a failed reload must release the old public routes')
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'recovered'`)
    for (let i = 0; i < 100; i++) {
        if (await fetch(cacheRoute).then(r => r.text()) === 'recovered') break
        await delay(50)
    }
    assert.equal(await fetch(cacheRoute).then(r => r.text()), 'recovered', 'fixing a helper must recover a failed reload automatically')
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'pending'`)
    await api('stop_plugin', { id: 'cache-reload' })
    await api('stop_plugin', { id: 'cache-observer' })
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'disabled'`)
    await delay(1200)
    assert.equal((await fetch(cacheRoute)).status, 404, 'helper edits must not restart disabled plugins')
    await api('start_plugin', { id: 'cache-reload' })
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'uninstall-pending'`)
    await rename(join(cwd, 'plugins/cache-reload'), join(cwd, 'uninstalled-plugin-link'))
    await delay(2200)
    await writeFile(join(cacheReload, 'value.js'), `module.exports = 'uninstalled'`)
    await delay(1600)
    assert.equal(child.exitCode, null, 'uninstalling with a pending reload must not crash HFS')
    const { list: installed } = await fetch(http + '/~/api/get_plugins').then(r => r.json()) as { list: { id: string }[] }
    assert.ok(!installed.some(plugin => plugin.id === 'cache-reload'), 'pending and later helper edits must not resurrect uninstalled plugins')
    assert.equal((await fetch(cacheRoute)).status, 404)

    await api('start_plugin', { id: 'reload-race' })
    const raceRoute = http + '/~/plugins/reload-race/value'
    assert.equal(await fetch(raceRoute).then(r => r.text()), 'original')
    const replacement = join(cwd, 'replacement')
    await mkdir(replacement)
    await writeFile(join(replacement, 'plugin.js'), reloadSource)
    await writeFile(join(replacement, 'helper.js'), 'module.exports = "replacement"')
    await rename(reloadFolder, join(cwd, 'old-reload-race'))
    await rename(replacement, reloadFolder)
    await expectReloadValue('replacement')
    await writeFile(join(reloadFolder, 'helper.js'), 'module.exports = "edited"')
    await expectReloadValue('edited')

    const entrypoint = join(reloadFolder, 'plugin.js')
    await writeFile(entrypoint, `
exports.apiRequired = 1
exports.init = async api => {
    const fs = api.require('node:fs')
    fs.writeFileSync('reload-pending', '')
    while (!fs.existsSync('release-reload'))
        await new Promise(resolve => setTimeout(resolve, 20))
    api.registerPublicRoute('value', ctx => { ctx.body = 'intermediate' })
}
`)
    try {
        for (let i = 0; i < 100; i++) {
            if (await access(join(cwd, 'reload-pending')).then(() => true, () => false)) break
            await delay(50)
        }
        await access(join(cwd, 'reload-pending'))
        await writeFile(entrypoint, reloadSource.replace("require('./helper')", '"latest"'))
        // let watchLoad read the second save while init is still blocked
        await delay(1100)
    }
    finally {
        await writeFile(join(cwd, 'release-reload'), '')
    }
    await expectReloadValue('latest')

    async function expectReloadValue(expected: string) {
        let value = ''
        for (let i = 0; i < 100; i++) {
            value = await fetch(raceRoute).then(r => r.text())
            if (value === expected) break
            await delay(50)
        }
        assert.equal(value, expected)
    }

    await api('start_plugin', { id: 'server-cleanup' })
    assert.deepEqual(await trace(), ['add:http', 'add:https'])
    const route = '/~/plugins/server-cleanup/description.xml'
    await api('set_config', { values: { force_https: true, proxies: 1 } })
    const headers = { 'x-forwarded-for': '198.51.100.19' }
    const publicGet = (path = route, method = 'GET') => fetch(http + path, {
        method, headers, redirect: 'manual', signal: AbortSignal.timeout(3000),
    })
    const metadata = await publicGet()
    assert.equal(metadata.status, 200)
    assert.match(metadata.headers.get('content-type') || '', /xml/)
    assert.equal(await metadata.text(), '<device>public</device>')
    assert.equal((await publicGet(route.replace('/~/', '/%7E/'))).status, 200)
    const head = await publicGet(route, 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    const post = await publicGet(route, 'POST')
    assert.equal(post.status, 405)
    assert.equal(post.headers.get('allow'), 'GET, HEAD')
    for (let i = 0; i < 50 && !(await readFile(join(cwd, 'public-error.log'), 'utf8')).includes(route); i++) await delay(20)
    assert.ok((await readFile(join(cwd, 'public-access.log'), 'utf8')).includes(route))
    assert.ok((await readFile(join(cwd, 'public-error.log'), 'utf8')).includes(route))
    assert.equal((await publicGet('/~/plugins/server-cleanup/error.xml')).status, 500)
    assert.equal((await publicGet('/~/api/get_status')).status, 307)
    assert.equal((await publicGet(route + '/extra')).status, 307)
    await api('set_config', { values: { roots: { 'other.example': '/' }, force_address: true } })
    assert.equal((await publicGet(route.replace('/~/', '/%7E/'))).status, 200)
    await assert.rejects(publicGet('/'), /fetch failed/)
    await api('set_config', { values: { roots: {}, force_address: false } })
    await api('set_config', { values: { block: [{ ip: headers['x-forwarded-for'] }] } })
    await assert.rejects(publicGet(), /fetch failed/)
    await api('set_config', { values: { block: [], force_https: false } })
    await probe(http, true)
    await probe(https, true)

    // create another real HTTPS server after subscription, exercising the listening-event path
    await api('set_config', { values: { https_port: -1 } })
    await api('set_config', { values: { https_port: 0 } })
    for (let i = 0; i < 50 && (await trace()).length < 3; i++) await delay(100)
    assert.deepEqual(await trace(), ['add:http', 'add:https', 'add:https'])
    assert.equal((await publicGet('/~/plugins/server-cleanup/status.xml')).status, 200)
    await api('set_plugin', { id: 'server-cleanup', config: { holdUnload: true } })
    let stopSettled = false
    let stopError: unknown
    const stopping = api('stop_plugin', { id: 'server-cleanup' }).then(
        () => { stopSettled = true }, error => { stopSettled = true; stopError = error })
    for (let i = 0; i < 50 && !(await trace()).includes('unload-pending'); i++) await delay(20)
    assert.ok((await trace()).includes('unload-pending'))
    // hold unload beyond waitRunning's polling interval to catch an early stop response
    await delay(100)
    const stoppedBeforeRelease = stopSettled
    await writeFile(join(cwd, 'release-stop'), '')
    await stopping
    assert.equal(stoppedBeforeRelease, false)
    assert.ifError(stopError)
    assert.equal((await publicGet()).status, 404)
    const stoppedTrace = await trace()
    assert.deepEqual(stoppedTrace.slice(3, -2).sort(), ['remove:http:false', 'remove:https:false', 'remove:https:false'])
    assert.deepEqual(stoppedTrace.slice(-2), ['unload-pending', 'unload'])
    await api('set_plugin', { id: 'server-cleanup', config: { holdUnload: false } })

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
    assert.equal((await publicGet()).status, 404)
    assert.deepEqual(await trace(), ['add:http', 'add:https', 'remove:http:false', 'remove:https:false'])

    await writeFile(join(cwd, 'trace'), '')
    await api('set_plugin', { id: 'server-cleanup', config: { failInit: false, failCallback: true } })
    await api('start_plugin', { id: 'server-cleanup' }, 500)
    assert.deepEqual(await trace(), ['add:http', 'remove:http:false'])
    assert.match(output, /expected async callback failure/)
    await api('set_plugin', { id: 'server-cleanup', enabled: false })

    await writeFile(join(cwd, 'trace'), '')
    await api('start_plugin', { id: 'racing-cleanup' })
    await api('set_plugin', { id: 'racing-cleanup', enabled: false })
    for (let i = 0; i < 50 && !(await trace()).includes('race-stopping:1'); i++) await delay(20)
    assert.deepEqual(await trace(), ['race-start:1', 'race-stopping:1'])
    await api('set_plugin', { id: 'racing-cleanup', enabled: true })
    // hold the old instance's unload while the reactivation request is processed
    await delay(100)
    await writeFile(join(cwd, 'release-race'), '')
    for (let i = 0; i < 50 && !(await trace()).includes('race-start:2'); i++) await delay(20)
    assert.deepEqual(await trace(), ['race-start:1', 'race-stopping:1', 'race-stopped:1', 'race-start:2'])
    assert.equal(await fetch(http + '/~/plugins/racing-cleanup/description.xml').then(r => r.text()), '2')
    await api('stop_plugin', { id: 'racing-cleanup' })
    assert.equal((await fetch(http + '/~/plugins/racing-cleanup/description.xml')).status, 404)

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
