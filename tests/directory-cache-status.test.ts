import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

test('cache status counts complete snapshots and includes active recursive scans', { timeout: 30000 }, async t => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'hfs-cache-status-')))
    const source = join(cwd, 'shared')
    await mkdir(join(source, 'child'), { recursive: true })
    await writeFile(join(source, 'first.txt'), 'first')
    await writeFile(join(source, 'child/slow.txt'), 'slow')
    // hold a real metadata read so the API can inspect a partially built recursive cache
    await writeFile(join(cwd, 'preload.cjs'), `
const fs = require('node:fs/promises');
const stat = fs.stat;
fs.stat = async function(path, ...args) {
    if (String(path) === ${JSON.stringify(join(source, 'child/slow.txt'))}) {
        await fs.writeFile(${JSON.stringify(join(cwd, 'blocked'))}, '');
        while (!await fs.readFile(${JSON.stringify(join(cwd, 'release'))}).then(() => true, () => false))
            await new Promise(resolve => setTimeout(resolve, 10));
    }
    return stat.call(this, path, ...args);
};
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '', upnp: false, directory_cache: -1,
        vfs: { source },
    }))
    const child = spawn(process.execPath, ['--require', join(cwd, 'preload.cjs'), resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    t.after(async () => { child.kill(); await exited; await rm(cwd, { recursive: true, force: true }) })
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    await waitFor(async () => {
        assert.equal(child.exitCode, null, output)
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        return Boolean(base) && await readFile(join(cwd, 'blocked')).then(() => true, () => false)
    })
    const building = await status()
    assert.equal(building.enabled, true)
    assert.equal(building.directories, 1)
    assert.equal(building.entries, 2)
    assert.deepEqual(building.updating, [source])
    await writeFile(join(cwd, 'release'), '')
    await waitFor(async () => !(await status()).updating.length)
    const ready = await status()
    assert.equal(ready.directories, 2)
    assert.equal(ready.entries, 3)
    assert.deepEqual(ready.updating, [])
    await rm(join(cwd, 'release'))
    await rm(join(cwd, 'blocked'))
    await api('refresh_directory_cache')
    const refreshing = await status()
    assert.equal(refreshing.entries, 3)
    assert.deepEqual(refreshing.updating, [source])
    await waitFor(() => readFile(join(cwd, 'blocked')).then(() => true, () => false))
    await writeFile(join(source, 'child/late.txt'), 'arrived during scan')
    await waitFor(async () => (await status()).updating.includes(join(source, 'child')))
    await writeFile(join(cwd, 'release'), '')
    await waitFor(async () => !(await status()).updating.length)
    assert.equal((await status()).entries, 4)
    await rm(join(cwd, 'release'))
    await rm(join(cwd, 'blocked'))
    await api('refresh_directory_cache')
    await waitFor(() => readFile(join(cwd, 'blocked')).then(() => true, () => false))
    await api('set_config', { values: { directory_cache: 0 } })
    const disabled = await status()
    assert.equal(disabled.enabled, false)
    assert.equal(disabled.entries, 0)
    assert.equal(disabled.directories, 0)
    assert.deepEqual(disabled.updating, [])
    await api('set_config', { values: { directory_cache: -1 } })
    assert.deepEqual((await status()).updating, [source])
    await writeFile(join(cwd, 'release'), '')
    await waitFor(async () => !(await status()).updating.length)
    assert.equal((await status()).entries, 4)

    function status() {
        return api('get_directory_cache_status')
    }

    async function api(command: string, body = {}) {
        const response = await fetch(base + '/~/api/' + command, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' }, body: JSON.stringify(body),
        })
        assert.equal(response.status, 200)
        return response.json()
    }

    async function waitFor(check: () => Promise<boolean>) {
        for (let i = 0; i < 100; i++) {
            if (await check()) return
            await delay(50)
        }
        assert.fail(output)
    }
})
