import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, symlink, copyFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ZipFile } from 'yazl'
import { Readable } from 'node:stream'

// Exercise the public APIs in a separate server, with real archives, streams, VFS masks and accounts.
test('archive extraction: permissions, overwrite, progress, cancellation and disk space', { timeout: 60000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-extract-'))
    const share = join(cwd, 'share')
    await mkdir(share)
    await writeFile(join(cwd, 'disk-check.cjs'), `
const fs = require('fs')
const statfs = fs.statfsSync
fs.statfsSync = function(...args) {
    fs.appendFileSync(${JSON.stringify(join(cwd, 'disk-checks'))}, 'check\\n')
    const result = statfs.apply(this, args)
    return { ...result, bavail: Math.floor(1024 ** 3 / result.bsize) } // deterministic 1 GiB capacity, including cached checks
}
const attrs = require(${JSON.stringify(require.resolve('fs-x-attributes'))})
const setAttr = attrs.set
const sep = require('node:path').sep
const metadataFailurePath = sep + 'meta-fail' + sep
attrs.set = function(path, ...args) {
    if (path.includes(metadataFailurePath) || path.includes(sep + 'fallback' + sep)) return args.at(-1)(Error('metadata unavailable'))
    return setAttr.call(this, path, ...args)
}
const { KvStorage } = require(${JSON.stringify(require.resolve('@rejetto/kvstorage'))})
const put = KvStorage.prototype.put
KvStorage.prototype.put = function(key, ...args) {
    if (String(key).includes(metadataFailurePath)) return Promise.reject(Error('metadata unavailable'))
    return put.call(this, key, ...args)
}
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, log: '', error_log: '', enable_plugins: [],
        accounts: { owner: { password: 'secret' }, other: { password: 'secret' }, admin: { password: 'secret', admin: true } },
        vfs: { source: share, can_upload: true, can_delete: true,
            masks: { 'no-upload': { can_upload: false }, 'no-upload/allowed': { can_upload: true }, 'no-delete': { can_delete: false }, '**/protected.txt': { can_delete: false } } },
    }))
    const child = spawn(process.execPath, ['--require', join(cwd, 'disk-check.cjs'), resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    t.after(async () => { child.kill(); await stopped; await rm(cwd, { recursive: true, force: true }) })
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    await until(() => {
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        assert.equal(child.exitCode, null, output)
        return Boolean(base)
    })

    await zip('small.zip', { 'a.txt': 'new', 'nested/b.txt': 'nested', 'protected.txt': 'overwrite' })
    await t.test('extract into a new subfolder and next to the archive, preserving protected files', async () => {
        await writeFile(join(share, 'protected.txt'), 'original')
        const sub = await start('small.zip', 'sub')
        assert.equal((await done(sub)).status, 'done', output)
        assert.equal(await readFile(join(share, 'sub/nested/b.txt'), 'utf8'), 'nested')
        const same = await start('small.zip', '')
        const result = await done(same)
        assert.equal(result.status, 'done', JSON.stringify(result))
        assert.equal(result.skipped, 1)
        assert.equal(result.extracted, 2)
        assert.equal(await readFile(join(share, 'protected.txt'), 'utf8'), 'original')
        assert.equal(await readFile(join(share, 'a.txt'), 'utf8'), 'new')
        assert.ok((await readFile(join(cwd, 'disk-checks'), 'utf8')).includes('check'))
    })

    await t.test('reject traversal, absolute destinations and missing permissions', async () => {
        await copyFile(join(share, 'small.zip'), join(share, 'unsupported.constructor'))
        assert.equal((await api('extract_archive', { uri: '/unsupported.constructor' })).status, 400)
        await mkdir(join(share, 'no-upload'))
        assert.equal((await api('extract_archive', { uri: '/small.zip', dest: 'no-upload/allowed' })).status, 403)
        for (const dest of ['../out', 'a/../b', '/tmp/out', 'C:\\out', 'C:out', '\\\\server\\out'])
            assert.equal((await api('extract_archive', { uri: '/small.zip', dest })).status, 400, dest)
        for (const dest of ['no-upload', 'no-delete'])
            assert.equal((await api('extract_archive', { uri: '/small.zip', dest })).status, 403, dest)
        await zip('permissions.zip', { 'no-upload/a.txt': 'no' })
        const result = await done(await start('permissions.zip', ''))
        assert.equal(result.status, 'error')
        await assert.rejects(stat(join(share, 'no-upload/a.txt')), { code: 'ENOENT' })
        await zip('nested-permissions.zip', { 'no-upload/allowed/a.txt': 'no' })
        assert.equal((await done(await start('nested-permissions.zip', ''))).status, 'error')
        await assert.rejects(stat(join(share, 'no-upload/allowed')), { code: 'ENOENT' })
        await mkdir(join(share, 'no-upload/allowed'))
        assert.equal((await done(await start('nested-permissions.zip', ''))).status, 'done')
        await zip('upload-only.zip', { 'no-delete/new.txt': 'allowed' })
        assert.equal((await done(await start('upload-only.zip', ''))).status, 'done')
    })

    await t.test('metadata failure preserves the existing file', async () => {
        await mkdir(join(share, 'meta-fail'))
        await writeFile(join(share, 'meta-fail/a.txt'), 'original')
        const result = await done(await start('small.zip', 'meta-fail'))
        assert.equal(result.status, 'error')
        assert.equal(await readFile(join(share, 'meta-fail/a.txt'), 'utf8'), 'original')
        assert.deepEqual(await readdir(join(share, 'meta-fail')), ['a.txt'])
    })

    await t.test('reject understated central and local sizes before publishing', async () => {
        await zip('forged.zip', { 'large.bin': Buffer.alloc(2 * 1024 * 1024, 42) })
        const buffer = await readFile(join(share, 'forged.zip'))
        buffer.writeUInt32LE(1, 22)
        const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
        buffer.writeUInt32LE(1, central + 24)
        await writeFile(join(share, 'forged.zip'), buffer)
        await api('set_config', { values: { min_available_mb: 1023 } }, 'admin')
        try {
            const result = await done(await start('forged.zip', 'forged'))
            assert.equal(result.status, 'error')
            assert.deepEqual(await readdir(join(share, 'forged')), [])
        }
        finally { await api('set_config', { values: { min_available_mb: 100 } }, 'admin') }
    })

    await t.test('streamed ZIP headers and duplicate names retain normal extraction behavior', async () => {
        const archive = new ZipFile()
        archive.addReadStream(Readable.from(['first']), 'same.txt')
        archive.addReadStream(Readable.from(['second']), 'same.txt')
        archive.end()
        await pipeline(archive.outputStream, createWriteStream(join(share, 'streamed.zip')))
        const result = await done(await start('streamed.zip', 'streamed'))
        assert.equal(result.status, 'done', JSON.stringify(result))
        assert.equal(result.extracted, 2)
        assert.equal(await readFile(join(share, 'streamed/same.txt'), 'utf8'), 'second')
    })

    await t.test('fallback metadata protects active content and rolls back a failed rename', async () => {
        await zip('fallback.zip', { 'page.html': '<script>untrusted()</script>' })
        assert.equal((await done(await start('fallback.zip', 'fallback'))).status, 'done')
        assert.equal((await fetch(base + '/fallback/page.html')).status, 403)
        assert.equal((await fetch(base + '/fallback/page.html?dl')).status, 200)
        await mkdir(join(share, 'fallback/directory'))
        await zip('rename-fail.zip', { 'directory': 'not a folder' })
        assert.equal((await done(await start('rename-fail.zip', 'fallback'))).status, 'error')
        assert.deepEqual(await readdir(join(share, 'fallback/directory')), [])
        const details = await api('get_file_details', { uris: ['/fallback/directory/'] }, 'admin').then(r => r.json())
        assert.deepEqual(details.details, [null])
        assert.deepEqual((await readdir(join(share, 'fallback'))).sort(), ['directory', 'page.html'])
    })

    await t.test('skip unsafe archive names and reject a destination symlink leaving the share', async () => {
        await zip('unsafe.zip', { 'aa/evil.txt': 'bad', 'ok.txt': 'good' })
        const buffer = await readFile(join(share, 'unsafe.zip'))
        // Keep local and central name lengths valid while simulating an untrusted ZIP producer.
        await writeFile(join(share, 'unsafe.zip'), Buffer.from(buffer.toString('latin1').replaceAll('aa/evil.txt', '../evil.txt'), 'latin1'))
        const result = await done(await start('unsafe.zip', 'safe'))
        assert.equal(result.status, 'done', JSON.stringify(result))
        assert.equal(result.skipped, 1)
        await assert.rejects(stat(join(share, 'evil.txt')), { code: 'ENOENT' })
        await mkdir(join(cwd, 'outside'))
        await symlink(join(cwd, 'outside'), join(share, 'link'), 'junction')
        assert.equal((await api('extract_archive', { uri: '/small.zip', dest: 'link' })).status, 403)
    })

    await t.test('private details and stop authorization, including anonymous credentials', async () => {
        const id = await start('small.zip', 'private')
        await done(id)
        const owned = (await snapshot('owner')).find(job => job.id === id)
        assert.equal(owned.uri, '/small.zip')
        assert.equal(owned.destination, '/private/')
        assert.ok((await snapshot('admin')).some(job => job.id === id))
        assert.deepEqual(await snapshot('other'), [])
        assert.deepEqual(await snapshot(''), [])
        assert.equal((await api('stop_extraction', { id }, 'other')).status, 404)
        const anon = await start('small.zip', 'anon', '')
        await done(anon, '', [anon])
        assert.ok((await snapshot('', [anon])).some(job => job.id === anon))
        assert.deepEqual(await snapshot(''), [])
        const progress = await api('get_extraction_progress', { uri: '/small.zip' }, '').then(r => r.json())
        assert.deepEqual(Object.keys(progress).sort(), ['list', 'progress', 'status'])
    })

    await t.test('keep only the latest 100 entries and retain totals', async () => {
        await zip('many.zip', Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`${i}.txt`, 'x'])))
        const result = await done(await start('many.zip', 'many'))
        assert.equal(result.status, 'done')
        assert.equal(result.extracted, 105)
        assert.equal(result.entries.length, 100)
        assert.equal(result.entries[0].path, '5.txt')
        assert.equal(result.truncated, true)
    })

    await t.test('same archive conflicts; stop removes partial output and preserves the previous file', async () => {
        await zip('large.zip', { 'first.txt': 'finished', 'large.bin': Buffer.alloc(128 * 1024 * 1024, 42) }, false)
        await mkdir(join(share, 'cancel'))
        await writeFile(join(share, 'cancel/large.bin'), 'original')
        const id = await start('large.zip', 'cancel')
        assert.equal((await api('extract_archive', { uri: '/large.zip', dest: 'elsewhere' })).status, 409)
        await until(async () => {
            const files = await readdir(join(share, 'cancel'))
            const temp = files.find(name => name.startsWith('hfs$upload-extract-'))
            return temp && (await stat(join(share, 'cancel', temp)).catch(() => ({ size: 0 }))).size > 0
        })
        assert.equal((await api('stop_extraction', { id })).status, 200)
        assert.equal((await done(id)).status, 'stopped')
        assert.equal(await readFile(join(share, 'cancel/first.txt'), 'utf8'), 'finished')
        assert.equal(await readFile(join(share, 'cancel/large.bin'), 'utf8'), 'original')
        assert.deepEqual((await readdir(join(share, 'cancel'))).sort(), ['first.txt', 'large.bin'])
    })

    await t.test('different archives may extract concurrently into the same destination', async () => {
        await copyFile(join(share, 'large.zip'), join(share, 'second.zip'))
        const [one, two] = await Promise.all([start('large.zip', 'parallel'), start('second.zip', 'parallel')])
        const results = await Promise.all([done(one), done(two)])
        assert.deepEqual(results.map(job => job.status), ['done', 'done'], JSON.stringify(results))
        assert.equal((await stat(join(share, 'parallel/large.bin'))).size, 128 * 1024 * 1024)
        assert.deepEqual((await readdir(join(share, 'parallel'))).sort(), ['first.txt', 'large.bin'])
    })

    await t.test('encrypted archives fail and active content retains upload approval rules', async () => {
        await zip('encrypted.zip', { 'secret.txt': 'secret' })
        const buffer = await readFile(join(share, 'encrypted.zip'))
        buffer.writeUInt16LE(buffer.readUInt16LE(6) | 1, 6)
        await writeFile(join(share, 'encrypted.zip'), buffer)
        const encrypted = await done(await start('encrypted.zip', 'encrypted'))
        assert.equal(encrypted.status, 'error')
        assert.match(encrypted.error, /Encrypted/)
        assert.deepEqual(await readdir(join(share, 'encrypted')), [])
        await zip('html.zip', { 'page.html': '<script>window.untrusted = true</script>' })
        assert.equal((await done(await start('html.zip', 'html'))).status, 'done')
        assert.equal((await fetch(base + '/html/page.html')).status, 403)
        assert.equal((await fetch(base + '/html/page.html?dl')).status, 200)
    })

    await t.test('space is checked again for each local entry header', async () => {
        await copyFile(join(share, 'large.zip'), join(share, 'understated.zip'))
        const buffer = await readFile(join(share, 'understated.zip'))
        const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
        for (let pos = buffer.indexOf(signature, buffer.indexOf(signature) + 4); pos >= 0; pos = buffer.indexOf(signature, pos + 4))
            buffer.writeUInt32LE(1, pos + 24) // untrusted central metadata understates the local entry size
        await writeFile(join(share, 'understated.zip'), buffer)
        await api('set_config', { values: { min_available_mb: 960 } }, 'admin')
        const result = await done(await start('understated.zip', 'per-file-space'))
        assert.equal(result.status, 'error')
        assert.match(result.error, /disk space/)
        assert.equal(result.extracted, 1)
        assert.deepEqual(await readdir(join(share, 'per-file-space')), ['first.txt'])
    })

    await t.test('insufficient initial disk space fails without writing archive files', async () => {
        assert.equal((await api('set_config', { values: { min_available_mb: 1e12 } }, 'admin')).status, 200)
        const result = await done(await start('small.zip', 'no-space'))
        assert.equal(result.status, 'error')
        assert.match(result.error, /disk space/)
        assert.deepEqual(await readdir(join(share, 'no-space')), [])
    })

    async function api(command: string, params = {}, user = 'owner') {
        return fetch(base + '/~/api/' + command, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1',
                ...(user && { authorization: 'Basic ' + Buffer.from(user + ':secret').toString('base64') }) },
            body: JSON.stringify(params),
        })
    }
    async function start(name: string, dest: string, user = 'owner') {
        const response = await api('extract_archive', { uri: '/' + name, dest }, user)
        assert.equal(response.status, 200, await response.clone().text())
        return (await response.json()).id as string
    }
    async function snapshot(user = 'owner', ids: string[] = []) {
        const response = await api('get_extractions', { ids }, user)
        assert.equal(response.status, 200, await response.clone().text())
        return (await response.json()).jobs as any[]
    }
    async function done(id: string, user = 'owner', ids: string[] = []) {
        let job: any
        await until(async () => {
            job = (await snapshot(user, ids)).find(job => job.id === id)
            return job?.status !== 'running' && job
        })
        return job
    }
    async function zip(name: string, files: Record<string, string | Buffer>, compress = true) {
        const zip = new ZipFile()
        for (const [path, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), path, { compress })
        zip.end()
        await pipeline(zip.outputStream, createWriteStream(join(share, name)))
    }
    async function until(check: () => unknown | Promise<unknown>) {
        for (let i = 0; i < 500; i++) {
            if (await check()) return
            await delay(20)
        }
        assert.fail('Timed out: ' + output.slice(-5000))
    }
})
