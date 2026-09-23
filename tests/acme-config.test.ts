import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'yaml'

test('DNS settings persist across restart, reject incompatible schemas and unregister plugins', { timeout: 30_000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-acme-config-'))
    await mkdir(join(cwd, 'plugins/test-dns'), { recursive: true })
    await writeFile(join(cwd, 'plugins/test-dns/plugin.js'), `
exports.apiRequired = 13.6
exports.init = api => {
    api.registerAcmeDnsProvider('Local test DNS', {
        config_version: 1,
        fields: { token: { secret: true } },
        async present() { return async () => {} }
    })
}
`)
    await writeFile(join(cwd, 'config.yaml'), yaml.stringify({ port: 0, listen_interface: '127.0.0.1', open_browser_at_start: false,
        enable_plugins: ['test-dns'], log: '', error_log: '', upnp: false }))
    const first = await start()
    await waitFor(async () => (await first.api('get_acme')).providers.some((p: { id: string }) => p.id === 'Local test DNS'))
    const settings = { domain: '*.example.test', renew: true, challenge: 'dns-01',
        dns: [{ id: 'main', provider: 'Local test DNS', config_version: 1, credentials: { token: 'secret-one' } }] }
    const saved = await first.api('set_acme', { settings })
    assert.deepEqual(saved.dns[0].credentials, { token: 'secret-one' })
    settings.dns[0].credentials.token = ''
    const cleared = await first.api('set_acme', { settings })
    assert.equal(cleared.dns[0].credentials.token, '')
    settings.dns[0].credentials.token = 'secret-one'
    await first.api('set_acme', { settings })
    const generic = await first.api('get_config', { only: ['acme_dns'] })
    assert.equal(generic.acme_dns[0].credentials.token, 'secret-one')
    await waitFor(async () => yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8')).acme_dns?.[0]?.credentials.token === 'secret-one')
    await first.stop()
    const second = await start()
    const restored = await second.api('get_acme')
    assert.equal(restored.domain, '*.example.test')
    assert.equal(restored.challenge, 'dns-01')
    assert.equal(restored.dns[0].id, 'main')
    assert.equal(restored.dns[0].credentials.token, 'secret-one')
    assert.equal(yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8')).acme_dns[0].credentials.token, 'secret-one')
    settings.dns[0].config_version = 2
    const bad = await second.raw('set_acme', { settings })
    assert.equal(bad.status, 400)
    await second.api('stop_plugin', { id: 'test-dns' })
    await waitFor(async () => !(await second.api('get_acme')).providers.some((p: { id: string }) => p.id === 'Local test DNS'))
    const response = await second.raw('make_cert', { domain: '*.example.test', background: true })
    assert.equal(response.status, 200)
    const reader = (await second.raw('get_acme_status')).body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    assert(text.includes('error'), text)
    assert(text.includes('unavailable'), text)
    assert(!text.includes('secret-one'))
    await reader.cancel()
    settings.dns[0].config_version = 1
    settings.challenge = 'http-01'
    const http = await second.api('set_acme', { settings })
    assert.equal(http.challenge, 'http-01')
    assert.equal(http.dns[0].credentials.token, 'secret-one')
    const wildcard = await second.raw('make_cert', { domain: 'example.test', altNames: ['*.files.example.test'] })
    assert.equal(wildcard.status, 500)
    assert.match(await wildcard.text(), /Select a DNS provider for wildcard certificates/)

    async function start() {
        const child = spawn(process.execPath, [resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
            env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HFS_'))), stdio: ['ignore', 'pipe', 'pipe'],
        })
        let output = '', url = ''
        child.stdout.on('data', chunk => output += chunk)
        child.stderr.on('data', chunk => output += chunk)
        const exited = once(child, 'exit')
        async function stop() {
            if (child.exitCode === null && child.signalCode === null) child.kill()
            await exited
        }
        t.after(stop)
        await waitFor(async () => {
            assert.equal(child.exitCode, null, output)
            url = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
            return Boolean(url)
        })
        function raw(name: string, body = {}) {
            return fetch(url + '/~/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hfs-anti-csrf': '1' }, body: JSON.stringify(body) })
        }
        async function api(name: string, body = {}) {
            const res = await raw(name, body)
            assert.equal(res.status, 200, await res.clone().text())
            return res.json()
        }
        return { stop, api, raw }
    }
})
async function waitFor(check: () => Promise<boolean>) {
    for (let i = 0; i < 100; i++) {
        if (await check()) return
        await delay(100)
    }
    assert.fail('timed out waiting for HFS')
}
