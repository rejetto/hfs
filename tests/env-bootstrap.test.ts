import test, { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'yaml'

test('HFS_ENV_BOOTSTRAP preserves existing configuration and accounts', { timeout: 15000 }, async t => {
    const { cwd, start } = await workspace(t)
    const config = { title: 'Saved title', accounts: { saved: { admin: true, disabled: true } } }
    await writeFile(join(cwd, 'config.yaml'), yaml.stringify(config))
    const server = await start({ HFS_ENV_BOOTSTRAP: 'true', HFS_TITLE: 'Environment title' })
    const response = await server.api('get_config', { only: ['title'] })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, config.title)
    // startup saves the version even without configuration edits; inspect that completed write
    await persisted(cwd, saved => Boolean(saved.version))
    const saved = yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8'))
    assert.equal(saved.title, config.title)
    assert.deepEqual(saved.accounts, config.accounts)
})

test('HFS_ENV_BOOTSTRAP initializes admin once and preserves a changed password on restart', { timeout: 25000 }, async t => {
    const { cwd, start } = await workspace(t)
    const env = { HFS_ENV_BOOTSTRAP: 'true', HFS_CREATE_ADMIN: 'initial-password', HFS_TITLE: 'Initial title' }
    const args = ['--localhost_admin', 'false']
    const first = await start(env, args)
    await persisted(cwd, saved => Boolean(saved.accounts?.admin?.srp))
    assert.equal((await first.api('get_accounts', {}, 'initial-password')).status, 200)
    const response = await first.api('get_config', { only: ['title'] }, 'initial-password')
    assert.equal((await response.json()).title, env.HFS_TITLE)
    const before = yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8')).accounts.admin.srp
    assert.equal((await first.api('set_account', {
        username: 'admin', changes: { password: 'changed-password' },
    }, 'initial-password')).status, 200)
    await persisted(cwd, saved => Boolean(saved.accounts?.admin?.srp && saved.accounts.admin.srp !== before))
    await first.stop()
    const second = await start(env, args)
    assert.equal((await second.api('get_accounts', {}, 'changed-password')).status, 200)
    assert.equal((await second.api('get_accounts', {}, 'initial-password')).status, 401)
})

test('configuration precedence with and without HFS_ENV_BOOTSTRAP', { timeout: 25000 }, async t => {
    for (const bootstrap of [false, true]) {
        for (const cli of [false, true]) {
            await t.test(`bootstrap=${bootstrap}, CLI=${cli}`, async t => {
                const { cwd, start } = await workspace(t)
                await writeFile(join(cwd, 'config.yaml'), yaml.stringify({ title: 'File title', show_hidden_files: true }))
                const server = await start({
                    HFS_TITLE: 'Environment title', HFS_SHOW_HIDDEN_FILES: 'true',
                    ...(bootstrap ? { HFS_ENV_BOOTSTRAP: 'true' } : {}),
                }, cli ? ['--title', 'CLI title', '--show_hidden_files', 'false'] : [])
                const response = await server.api('get_config', { only: ['title', 'show_hidden_files'] })
                assert.equal(response.status, 200)
                assert.deepEqual(await response.json(), {
                    title: cli ? 'CLI title' : bootstrap ? 'File title' : 'Environment title',
                    show_hidden_files: !cli,
                })
            })
        }
    }
})

async function workspace(t: TestContext) {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-env-bootstrap-'))
    const stops: (() => Promise<void>)[] = []
    t.after(async () => {
        for (const stop of stops) await stop()
        await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) // allow Windows to release file handles after process exit
    })
    return { cwd, start: (env: NodeJS.ProcessEnv, args: string[] = []) => startServer(cwd, stops, env, args) }
}

async function startServer(cwd: string, stops: (() => Promise<void>)[], env: NodeJS.ProcessEnv, args: string[]) {
    // CLI options keep even the broken server isolated and accessible for inspecting its configuration
    const options = {
        cwd, port: '0', listen_interface: '127.0.0.1', localhost_admin: 'true',
        open_browser_at_start: 'false', enable_plugins: '[]', log: '', error_log: '',
    }
    // replace overridden options rather than passing duplicate flags to minimist
    const extra = [...args]
    for (const [key, value] of Object.entries(options))
        if (!args.includes('--' + key)) extra.push('--' + key, value)
    const child = spawn(process.execPath, [resolve(__dirname, '../dist/src/index.js'), '--no-central', ...extra], {
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HFS_'))), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    stops.push(stop)
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    let url = ''
    for (let i = 0; i < 100; i++) {
        url = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        if (url) break
        assert.equal(child.exitCode, null, output)
        await delay(100)
    }
    assert.ok(url, output)
    return { stop, api }

    async function stop() {
        if (child.exitCode === null && child.signalCode === null) child.kill()
        await stopped
    }
    function api(name: string, body = {}, password?: string) {
        return fetch(url + '/~/api/' + name, {
            method: 'POST', headers: {
                'Content-Type': 'application/json', 'x-hfs-anti-csrf': '1',
                ...(password ? { Authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64') } : {}),
            }, body: JSON.stringify(body),
        })
    }
}

async function persisted(cwd: string, check: (saved: { version?: string, accounts?: Record<string, { srp?: string }> }) => boolean) {
    // wait for the debounced write before stopping the server or inspecting persisted values
    for (let i = 0; i < 50; i++) {
        const saved = await readFile(join(cwd, 'config.yaml'), 'utf8').then(text => yaml.parse(text), () => undefined)
        if (saved && check(saved)) return
        await delay(100)
    }
    assert.fail('expected configuration was not persisted')
}
