import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

test('plugin search composes predicates before pagination and cleans registrations on unload', { timeout: 20000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-plugin-search-'))
    await mkdir(join(cwd, 'shared/sub'), { recursive: true })
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'hidden-legacy.txt', 'hidden-event.txt', 'sub/d.txt'])
        await writeFile(join(cwd, 'shared', name), name)
    for (const id of ['first', 'second']) {
        await mkdir(join(cwd, 'plugins', id), { recursive: true })
        await writeFile(join(cwd, 'plugins', id, 'plugin.js'), `
exports.apiRequired = 14
exports.onDirEntry = ({ entry }) => entry.n !== 'hidden-legacy.txt'
exports.init = api => {
    const { ApiError } = api.require('./apiMiddleware')
    const fs = require('node:fs')
    api.events.on('dirEntry', ({ entry }, { preventDefault }) => {
        if (entry.n === 'hidden-event.txt') preventDefault()
    })
    const provider = {
        label: ${JSON.stringify(id)},
        ${id === 'first' ? "labelKey: 'first_label'," : ''}
        prepare(value) {
            if (typeof value !== 'string') throw new ApiError(400, 'invalid criterion')
            return async node => {
                if (!node.source || !node.source.endsWith('.txt')) return false
                if (value === 'wait') {
                    fs.writeFileSync('waiting', '')
                    while (!fs.existsSync('release')) await new Promise(resolve => setTimeout(resolve, 10))
                }
                if (value === 'throw') throw Error('plugin search failed')
                if (value === 'unknown') return undefined
                return node.source.endsWith(value)
            }
        }
    }
    const old = api.registerSearch(provider)
    old()
    api.registerSearch(provider)
    old() // old cleanups must not unregister a newer registration
}
`)
    }
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '', enable_plugins: ['first', 'second'],
        zip_calculate_size_for_seconds: 0,
        vfs: { children: [{ name: 'files', source: join(cwd, 'shared') }] },
    }))
    const child = spawn(process.execPath, [resolve('dist/src/index.js'), '--cwd', cwd, '--no-central'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    t.after(async () => { await writeFile(join(cwd, 'release'), ''); child.kill(); await exited; await rm(cwd, { recursive: true, force: true }) })
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    for (let i = 0; i < 150; i++) {
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        assert.equal(child.exitCode, null, output)
        if (base && (await list({})).searchFields?.length === 2) break
        await delay(40)
    }
    const full = await list({ first: '.txt' })
    assert.deepEqual(full.searchFields.sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'first', label: 'first', labelKey: 'first_label' }, { id: 'second', label: 'second' }])
    assert.deepEqual(full.list.map(x => x.n).sort(), ['a.txt', 'b.txt', 'c.txt', 'sub/d.txt'])
    assert.deepEqual((await list({ first: '.txt', second: 'd.txt' })).list.map(x => x.n), ['sub/d.txt'])
    assert.deepEqual((await list({ first: '.txt' }, { 'ps.second': 'd.txt' })).list.map(x => x.n), ['sub/d.txt'])
    assert.deepEqual((await list({ first: 'absent' }, { 'ps.first': 'a.txt' })).list.map(x => x.n), ['a.txt'])
    assert.deepEqual((await list({ first: '.txt' }, { offset: '1', limit: '1' })).list.map(x => x.n), [full.list[1].n])
    const unknown = await list({ first: 'unknown' })
    assert.deepEqual(unknown.list, [])
    assert.deepEqual(unknown.searchIncomplete, ['first'])
    assert.deepEqual((await list({ first: 'unknown', second: 'absent' })).searchIncomplete, [])
    assert.equal((await request({ first: 42 })).status, 400)
    assert.equal((await request({ unavailable: 'a' })).status, 400)
    assert.equal((await request({}, { 'ps.unavailable': 'a' })).status, 400)
    assert.equal((await request({}, { 'ps.': 'a' })).status, 400)
    const compactZip = await fetch(base + '/files/?' + new URLSearchParams({ get: 'zip', 'ps.first': 'a.txt' }))
    assert.equal(compactZip.status, 200)
    const { Open } = await import('unzipper')
    assert.deepEqual((await Open.buffer(Buffer.from(await compactZip.arrayBuffer()))).files.map(x => x.path), ['a.txt'])

    for (const search of ['hidden-legacy.txt', 'hidden-event.txt']) {
        const hidden = await list({ first: 'unknown' }, { search })
        assert.deepEqual(hidden.list, [])
        assert.deepEqual(hidden.searchIncomplete, [])
    }

    // enumeration errors after headers are sent must abort the download, rather than hang it
    await assert.rejects(async () => {
        const response = await fetch(base + '/files/?' + new URLSearchParams({
            get: 'zip', pluginSearch: JSON.stringify({ first: 'throw' }),
        }), { signal: AbortSignal.timeout(5000) })
        await response.arrayBuffer()
    }, TypeError)
    assert.deepEqual((await list({ first: '.txt' })).list.map(x => x.n).sort(), ['a.txt', 'b.txt', 'c.txt', 'sub/d.txt'])

    // stop a real provider while its asynchronous predicate is suspended
    const waiting = request({ first: 'wait' })
    for (let i = 0; i < 100 && !await readFile(join(cwd, 'waiting')).then(() => true, () => false); i++) await delay(20)
    await api('stop_plugin', { id: 'first' })
    await writeFile(join(cwd, 'release'), '')
    assert.equal((await waiting).status, 503)
    assert.equal((await request({ first: 'a' })).status, 400)
    assert.deepEqual((await list({})).searchFields.map(x => x.id), ['second'])

    async function request(criteria: object, params: Record<string, string> = {}) {
        return fetch(base + '/~/api/get_file_list?' + new URLSearchParams({ uri: '/files/', pluginSearch: JSON.stringify(criteria), ...params }))
    }
    async function list(criteria: object, params: Record<string, string> = {}) {
        const response = await request(criteria, params)
        assert.equal(response.status, 200, await response.clone().text())
        return response.json() as Promise<{ list: { n: string }[], searchFields: { id: string }[], searchIncomplete: string[] }>
    }
    async function api(name: string, data: object) {
        const response = await fetch(base + '/~/api/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' }, body: JSON.stringify(data) })
        assert.equal(response.status, 200, await response.text())
    }
})
