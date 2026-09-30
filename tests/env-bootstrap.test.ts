import test, { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'yaml'
import { KvStorage } from '@rejetto/kvstorage'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'

for (const via of ['api', 'file', 'offline'] as const)
    test(`account configuration changes reconcile sessions via ${via}`, { timeout: 25000 }, async t => {
        const { cwd, start } = await workspace(t)
        const env = { HFS_ENV_BOOTSTRAP: 'true', HFS_CREATE_ADMIN: 'initial-password', COOKIE_SIGN_KEYS: 'config-edit-test-key' }
        const args = ['--localhost_admin', 'false']
        let server = await start(env, args)
        const adminPass = 'initial-password'
        assert.equal((await server.api('add_account', { username: 'alice', password: 'old-password' }, adminPass)).status, 200)
        const login = await server.api('login', { username: 'alice', password: 'old-password' })
        assert.equal(login.status, 200)
        const oldCookie = cookies(login)
        await persisted(cwd, saved => Boolean(saved.accounts?.alice?.srp))
        const config = yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8'))
        config.accounts.alice.notes = 'unrelated edit'
        await changeConfig()
        assert.equal((await (await server.api('refresh_session', {}, undefined, oldCookie)).json()).username, 'alice')
        const verifier = await createVerifierAndSalt(new SRPRoutines(new SRPParameters()), 'alice', 'new-password')
        config.accounts.alice.srp = `${verifier.s}|${verifier.v}`
        await changeConfig()
        assert.equal((await (await server.api('refresh_session', {}, undefined, oldCookie)).json()).username, '')
        const fresh = await server.api('login', { username: 'alice', password: 'new-password' })
        assert.equal(fresh.status, 200)
        const freshCookie = cookies(fresh)
        const replacement = config.accounts.alice
        delete config.accounts.alice
        await changeConfig()
        config.accounts.alice = replacement
        await changeConfig()
        assert.equal((await (await server.api('refresh_session', {}, undefined, freshCookie)).json()).username, '')

        async function changeConfig() {
            if (via === 'api') {
                assert.equal((await server.api('set_config', { values: { accounts: config.accounts } }, adminPass)).status, 200)
                await persisted(cwd, saved => JSON.stringify(saved.accounts) === JSON.stringify(config.accounts))
            }
            else {
                if (via === 'offline') await server.stop(adminPass)
                await writeFile(join(cwd, 'config.yaml'), yaml.stringify(config))
                if (via === 'offline') server = await start(env, args)
            }
            for (let i = 0; i < 100; i++) {
                const current = await (await server.api('get_config', { only: ['accounts'] }, adminPass)).json()
                if (JSON.stringify(current.accounts) === JSON.stringify(config.accounts)) return
                await delay(30)
            }
            assert.fail('account configuration did not reload')
        }
    })

test('HFS_ENV_BOOTSTRAP preserves existing configuration and accounts', { timeout: 15000 }, async t => {
    const { cwd, start } = await workspace(t)
    const config = { title: 'Saved title', accounts: { saved: { admin: true, disabled: true } } }
    await writeFile(join(cwd, 'config.yaml'), yaml.stringify(config))
    const server = await start({ HFS_ENV_BOOTSTRAP: 'true', HFS_TITLE: 'Environment title' })
    const response = await server.api('get_config', { only: ['title'] })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, config.title)
    // startup saves the version even without configuration edits; inspect that completed write
    const saved = await persisted(cwd, saved => Boolean(saved.version))
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
    await first.stop('changed-password')
    const second = await start(env, args)
    assert.equal((await second.api('get_accounts', {}, 'changed-password')).status, 200)
    assert.equal((await second.api('get_accounts', {}, 'initial-password')).status, 401)
})

test('session revocation persists across restarts while the password-changing session survives', { timeout: 30000 }, async t => {
    const { cwd, start } = await workspace(t)
    const env = { HFS_ENV_BOOTSTRAP: 'true', HFS_CREATE_ADMIN: 'initial-password', COOKIE_SIGN_KEYS: 'session-revocation-test-key' }
    const args = ['--localhost_admin', 'false']
    const first = await start(env, args)
    const login = await first.api('login', { username: 'admin', password: 'initial-password' })
    assert.equal(login.status, 200)
    const oldCookie = cookies(login)
    assert.match(session(login).stamp, /^\d+\.\d{3}$/)
    assert.equal(session(login).sessionEpoch, undefined)
    const changed = await first.api('set_account', {
        username: 'admin', changes: { password: 'changed-password' },
    }, undefined, oldCookie)
    assert.equal(changed.status, 200)
    const currentCookie = cookies(changed)
    assert.notEqual(currentCookie, oldCookie)
    assert.notEqual(session(changed).stamp, session(login).stamp)
    const account = await (await first.api('get_account', { username: 'admin' }, undefined, currentCookie)).json()
    assert.equal(account.invalidated, Number(session(changed).stamp.split('.')[0]))
    await persisted(cwd, saved => Boolean(saved.accounts?.admin?.srp))
    await first.stop('changed-password')
    const saved = yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8')).accounts.admin
    assert.equal(saved.sessionStamp, undefined)
    assert.equal(await storedStamp(cwd), session(changed).stamp)
    const second = await start(env, args)
    assert.equal((await (await second.api('refresh_session', {}, undefined, currentCookie)).json()).username, 'admin')
    assert.equal((await (await second.api('refresh_session', {}, undefined, oldCookie)).json()).username, '')
    assert.equal((await second.api('invalidate_sessions', { username: 'admin' }, undefined, currentCookie)).status, 200)
    await second.stop('changed-password')
    const third = await start(env, args)
    assert.equal((await (await third.api('refresh_session', {}, undefined, currentCookie)).json()).username, '')
    assert.equal((await third.api('get_accounts', {}, 'changed-password')).status, 200)
})

test('random signing keys keep session stamps out of config and data and reject cookies after restart', { timeout: 20000 }, async t => {
    const { cwd, start } = await workspace(t)
    const env = { HFS_ENV_BOOTSTRAP: 'true', HFS_CREATE_ADMIN: 'initial-password' }
    const args = ['--localhost_admin', 'false']
    const first = await start(env, args)
    const login = await first.api('login', { username: 'admin', password: 'initial-password' })
    assert.equal(login.status, 200)
    assert.match(session(login).stamp, /^\d+\.\d{3}$/)
    await persisted(cwd, saved => Boolean(saved.accounts?.admin?.srp))
    await first.stop('initial-password')
    assert.equal(await storedStamp(cwd), undefined)
    const saved = yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8')).accounts.admin
    assert.equal(saved.sessionStamp, undefined)
    const second = await start(env, args)
    assert.equal((await (await second.api('refresh_session', {}, undefined, cookies(login))).json()).username, '')
})

test('temporarily disabling fixed signing keys cannot revive cookies when they are restored', { timeout: 20000 }, async t => {
    const { start } = await workspace(t)
    const env = { HFS_ENV_BOOTSTRAP: 'true', HFS_CREATE_ADMIN: 'initial-password', COOKIE_SIGN_KEYS: 'temporary-fixed-key' }
    const args = ['--localhost_admin', 'false']
    const first = await start(env, args)
    const login = await first.api('login', { username: 'admin', password: 'initial-password' })
    assert.equal(login.status, 200)
    const cookie = cookies(login)
    await first.stop('initial-password')
    const second = await start({ ...env, COOKIE_SIGN_KEYS: undefined }, args)
    assert.equal((await second.api('set_account', {
        username: 'admin', changes: { password: 'changed-password' },
    }, 'initial-password')).status, 200)
    await second.stop('changed-password')
    const third = await start(env, args)
    assert.equal((await (await third.api('refresh_session', {}, undefined, cookie)).json()).username, '')
})

function cookies(response: Response) {
    const values = response.headers.getSetCookie()
    assert.ok(values.length, 'missing session cookies')
    return values.map(value => value.split(';')[0]).join('; ')
}

function session(response: Response) {
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('hfs_http='))!
    assert.ok(cookie, 'missing session cookie')
    return JSON.parse(Buffer.from(cookie.split(';')[0]!.slice('hfs_http='.length), 'base64').toString())
}

async function storedStamp(cwd: string) {
    const db = new KvStorage()
    await db.open(join(cwd, 'data.kv'))
    try { return (await db.get('sessionStamp:admin'))?.stamp }
    finally { await db.close() }
}

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
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HFS_') && key !== 'COOKIE_SIGN_KEYS')), ...env },
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

    async function stop(password?: string) {
        if (child.exitCode === null && child.signalCode === null) {
            const response = await api('quit', {}, password).catch(() => undefined)
            if (response?.status !== 200) child.kill()
        }
        await stopped
    }
    // response shapes are checked by assertions in each test
    function api(name: string, body = {}, password?: string, cookie?: string): Promise<Omit<Response, 'json'> & { json(): Promise<any> }> {
        return fetch(url + '/~/api/' + name, {
            method: 'POST', headers: {
                'Content-Type': 'application/json', 'x-hfs-anti-csrf': '1',
                ...(password ? { Authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64') } : {}),
                ...(cookie ? { Cookie: cookie } : {}),
            }, body: JSON.stringify(body),
        })
    }
}

async function persisted(cwd: string, check: (saved: { version?: string, accounts?: Record<string, { srp?: string }> }) => boolean) {
    // wait for the debounced write before stopping the server or inspecting persisted values
    for (let i = 0; i < 50; i++) {
        const saved = await readFile(join(cwd, 'config.yaml'), 'utf8').then(text => yaml.parse(text), () => undefined)
        if (saved && check(saved)) return saved
        await delay(100)
    }
    assert.fail('expected configuration was not persisted')
}
