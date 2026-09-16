import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'yaml'

test('create-admin survives startup defaults while VFS loads asynchronously', { timeout: 15000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-create-admin-'))
    const source = join(cwd, 'missing')
    // delay only the backing source stat so the bootstrap timer runs before startup defaults
    const preload = join(cwd, 'slow-stat.cjs')
    await writeFile(preload, `
const fs = require('node:fs/promises')
const stat = fs.stat
fs.stat = async function (path, ...args) {
    if (path === ${JSON.stringify(source)}) {
        console.log('Delayed VFS stat')
        await new Promise(resolve => setTimeout(resolve, 200))
    }
    return stat.call(this, path, ...args)
}
`)
    await writeFile(join(cwd, 'config.yaml'), yaml.stringify({
        port: 0, listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, enable_plugins: [], log: '', error_log: '',
        'create-admin': 'bootstrap-test-password', vfs: { source },
        // accounts must be absent: its startup default used to overwrite the new admin
    }))
    const child = spawn(process.execPath, [
        '--require', preload, resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stopped = once(child, 'exit')
    t.after(async () => {
        child.kill()
        await stopped
        await rm(cwd, { recursive: true, force: true })
    })
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    let url = ''
    for (let i = 0; i < 100; i++) {
        url = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        if (url && output.includes('Account admin set')) break
        assert.equal(child.exitCode, null, output)
        await delay(100)
    }
    assert.ok(url && output.includes('Account admin set'), output)
    assert.match(output, /Delayed VFS stat/)
    const response = await fetch(url + '/~/api/get_accounts', {
        headers: { Authorization: 'Basic ' + Buffer.from('admin:bootstrap-test-password').toString('base64') },
    })
    assert.equal(response.status, 200, 'bootstrap admin must remain available after startup defaults')
    const { list } = await response.json() as { list: { username: string, adminActualAccess: boolean }[] }
    assert.ok(list.some(x => x.username === 'admin' && x.adminActualAccess))
    // configuration writes are debounced, so wait for persistence independently of login
    for (let i = 0; i < 50; i++) {
        const saved = yaml.parse(await readFile(join(cwd, 'config.yaml'), 'utf8'))
        if (saved.accounts?.admin?.srp && !saved['create-admin']) return
        await delay(100)
    }
    assert.fail('bootstrap admin was not persisted')
})
