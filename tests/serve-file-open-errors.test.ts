import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { get } from 'node:http'

test('file open failures return HTTP errors before streaming, including downloads and ranges', { timeout: 30000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-open-errors-'))
    const files = ['gone.mp3', 'denied.mp3', 'cafe\u0301.mp3', 'good.mp3', 'empty.mp3', 'slow.mp3']
    for (const name of files)
        await writeFile(join(cwd, name), name === 'empty.mp3' ? '' : 'audio content')
    await writeFile(join(cwd, 'preload.cjs'), `
const fs = require('node:fs'), { basename } = require('node:path');
const open = fs.open;
const close = fs.close;
let slowFd;
fs.close = function(fd, ...args) {
    if (fd === slowFd) fs.writeFileSync(${JSON.stringify(join(cwd, 'closed'))}, '');
    return close.call(this, fd, ...args);
};
fs.open = function(path, flags, mode, cb) {
    const name = basename(String(path));
    if (name === 'slow.mp3') {
        fs.writeFileSync(${JSON.stringify(join(cwd, 'opening'))}, '');
        setTimeout(() => open.call(this, path, flags, mode, (error, fd) => { slowFd = fd; cb(error, fd) }), 150);
        return;
    }
    const code = name === 'denied.mp3' ? 'EACCES' : ['gone.mp3', 'cafe\\u0301.mp3'].includes(name) ? 'ENOENT' : undefined;
    if (code) {
        // delay the failure to expose responses committed before the file is opened
        setTimeout(() => cb(Object.assign(Error(code), { code })), 30);
        return;
    }
    return open.call(this, path, flags, mode, cb);
};
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '', upnp: false, vfs: { source: cwd },
    }))
    const child = spawn(process.execPath, ['--require', join(cwd, 'preload.cjs'), resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    t.after(async () => { child.kill(); await exited; await rm(cwd, { recursive: true, force: true }) })
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    for (let i = 0; i < 100 && !base; i++) {
        await delay(50)
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        assert.equal(child.exitCode, null, output)
    }
    assert.ok(base, output)
    for (const name of files.slice(0, 3)) {
        for (const range of [false, true]) {
            const response = await fetch(base + '/' + encodeURIComponent(name) + '?dl', {
                headers: range ? { Range: 'bytes=1-3' } : {},
            })
            assert.equal(response.status, name === 'denied.mp3' ? 403 : 404, output)
            assert.match(await response.text(), /<h1>(Not found|Forbidden)<\/h1>/)
            assert.ok(!response.headers.get('Content-Disposition'))
            assert.equal(response.headers.get('Content-Range'), null)
            for (const header of ['ETag', 'Last-Modified', 'Cache-Control', 'Accept-Ranges'])
                assert.equal(response.headers.get(header), null, header)
        }
    }
    const good = await fetch(base + '/good.mp3')
    assert.equal(good.status, 200)
    assert.equal(await good.text(), 'audio content')
    assert.ok(good.headers.get('ETag'))
    const cached = await fetch(base + '/good.mp3', { cache: 'no-cache', headers: { 'If-None-Match': good.headers.get('ETag')! } })
    assert.equal(cached.status, 304)
    assert.equal(await cached.text(), '')
    const head = await fetch(base + '/gone.mp3?dl', { method: 'HEAD' })
    assert.equal(head.status, 404)
    assert.equal(await head.text(), '')
    const range = await fetch(base + '/good.mp3', { headers: { Range: 'bytes=1-3' } })
    assert.equal(range.status, 206)
    assert.equal(await range.text(), 'udi')
    const empty = await fetch(base + '/empty.mp3')
    assert.equal(empty.status, 200)
    assert.equal(await empty.text(), '')
    const request = get(base + '/slow.mp3')
    request.on('error', () => {}) // cancellation intentionally closes the connection before the response
    try {
        for (let i = 0; i < 100 && !await readFile(join(cwd, 'opening')).then(() => true, () => false); i++) await delay(10)
        assert.equal(await readFile(join(cwd, 'opening'), 'utf8'), '')
    }
    finally { request.destroy() }
    for (let i = 0; i < 100 && !await readFile(join(cwd, 'closed')).then(() => true, () => false); i++) await delay(10)
    assert.equal(await readFile(join(cwd, 'closed'), 'utf8'), '', 'aborting before open must still close the file descriptor')
    if (process.platform === 'darwin') {
        const help = 'https://github.com/rejetto/hfs/wiki/Troubleshooting#macos-smb-unicode-filenames-not-working'
        for (let i = 0; i < 100 && !output.includes(help); i++) await delay(10)
        assert.ok(output.includes(help), output)
    }
})
