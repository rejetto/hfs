import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import unzipper from 'unzipper'
import { API_URI, UPLOAD_TEMP_PREFIX, UPLOAD_TEMP_HASH } from '../src/cross-const'
import { KvStorage } from '@rejetto/kvstorage'

test('unfinished uploads are private to their owner and administrators', { timeout: 60000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-unfinished-visibility-'))
    const share = join(cwd, 'share')
    const temp = UPLOAD_TEMP_PREFIX + 'file.txt'
    const owner = credentials('owner')
    const other = credentials('other')
    const admin = credentials('admin')
    let child: ChildProcess, stopped: Promise<unknown>, base = '', output = ''
    await mkdir(share)
    await writeFile(join(share, 'ordinary.txt'), 'ordinary')
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, enable_plugins: [], log: '', error_log: '', min_available_mb: 0,
        delete_unfinished_uploads_after: '', show_uploader: true, force_webdav_login: false, webdav_initial_auth: false,
        accounts: { owner: { password: 'secret' }, other: { password: 'secret' }, admin: { password: 'secret', admin: true } },
        vfs: { source: share, can_upload: true, can_delete: true,
            masks: { '*.txt': { can_read: true, can_see: true } },
            children: [{ name: 'alias', source: share, can_upload: true, can_delete: true }] },
    }))
    t.after(async () => {
        child?.kill('SIGKILL')
        await stopped
        await rm(cwd, { recursive: true, force: true })
    })
    await start()

    await t.test('partial upload is absent from direct reads and all listings for another account', async () => {
        assert.equal((await send('/file.txt?partial=20', owner, { method: 'PUT', body: 'private' })).status, 204)
        await assertPrivate(temp, other)
        assert.equal(await (await send('/' + temp, owner)).text(), 'private')
        assert.equal(await (await send('/' + temp, admin)).text(), 'private')
        assert.equal(await (await send('/alias/' + temp, owner)).text(), 'private')
        assert.equal((await send('/file.txt?get=' + UPLOAD_TEMP_HASH, owner)).status, 200)
        assert.equal((await send('/file.txt?get=' + UPLOAD_TEMP_HASH, other)).status, 404)
        assert.equal((await send('/file.txt?resume=0!', other, { method: 'PUT', body: 'replacement' })).status, 404)
        assert.equal(await readFile(join(share, temp), 'utf8'), 'private')
    })

    await t.test('innocuous symlinks retain physical ownership', { skip: process.platform === 'win32' }, async () => {
        await symlink(temp, join(share, 'innocent.txt'))
        await assertPrivate('innocent.txt', other)
        assert.equal(await (await send('/innocent.txt', owner)).text(), 'private')
        assert.equal(await (await send('/innocent.txt', admin)).text(), 'private')
    })

    await t.test('completed names using the temporary prefix remain public without a delete grant', async () => {
        await api('set_config', { values: { own_upload_delete_hours: 0 } }, admin)
        try {
            assert.equal((await send('/' + UPLOAD_TEMP_PREFIX + 'report.txt', owner, { method: 'PUT', body: 'complete' })).status, 200)
            assert.equal(await (await send('/' + UPLOAD_TEMP_PREFIX + 'report.txt', owner)).text(), 'complete')
            assert.equal(await (await send('/' + UPLOAD_TEMP_PREFIX + 'report.txt', other)).text(), 'complete')
        }
        finally { await api('set_config', { values: { own_upload_delete_hours: 24 } }, admin) }
    })

    await t.test('an owner continues through another ordinary folder alias', async () => {
        assert.equal((await send('/alias-continuation.txt?partial=20', owner, { method: 'PUT', body: 'private' })).status, 204)
        assert.equal((await send('/alias/alias-continuation.txt?resume=7', other, { method: 'PUT', body: '-done' })).status, 404)
        assert.equal((await send('/alias/alias-continuation.txt?resume=7', owner, { method: 'PUT', body: '-done' })).status, 200)
        assert.equal(await readFile(join(share, 'alias-continuation.txt'), 'utf8'), 'private-done')
    })

    await t.test('a VFS remap cannot attach old ownership to a different physical temp', async () => {
        const first = join(cwd, 'first'), second = join(cwd, 'second')
        await mkdir(first)
        await mkdir(second)
        await api('add_vfs', { name: 'confined', source: first, can_upload: true, can_delete: true }, admin)
        try {
            assert.equal((await send('/confined/file.txt?partial=20', owner, { method: 'PUT', body: 'private' })).status, 204)
            await writeFile(join(second, temp), 'foreign')
            await api('set_vfs', { uri: '/confined', props: { source: second } }, admin)
            assert.equal((await send('/confined/file.txt?resume=7', owner, { method: 'PUT', body: '-done' })).status, 404)
            assert.equal(await readFile(join(second, temp), 'utf8'), 'foreign')
        }
        finally { await api('del_vfs', { uris: ['/confined'] }, admin) }
    })

    await t.test('active upload stays private while the completed destination stays public', async () => {
        await writeFile(join(share, 'active.txt'), 'old')
        const req = request(base + '/active.txt', { method: 'PUT', headers: { ...owner, 'content-length': 12 } })
        const response = once(req, 'response')
        t.after(() => req.destroy())
        req.write('private')
        await until(() => stat(join(share, UPLOAD_TEMP_PREFIX + 'active.txt')).then(s => s.size === 7, () => false))
        await assertPrivate(UPLOAD_TEMP_PREFIX + 'active.txt', other)
        assert.equal(await (await send('/' + UPLOAD_TEMP_PREFIX + 'active.txt', owner)).text(), 'private')
        assert.equal(await (await send('/active.txt', other)).text(), 'old')
        assert.equal((await send('/active.txt', other, { method: 'PUT', body: 'foreign' })).status, 404)
        req.end('-done')
        const [res] = await response
        res.resume()
        assert.equal(res.statusCode, 200)
        assert.equal(await (await send('/active.txt', other)).text(), 'old')
        assert.equal(await (await send('/active%20(1).txt', other)).text(), 'private-done')
    })

    await t.test('aborted uploads retain owner visibility and continuation', async () => {
        const name = 'aborted.txt'
        const req = request(base + '/' + name, { method: 'PUT', headers: { ...owner, 'content-length': 1000 } })
        req.on('error', () => {}) // cancellation deliberately resets the connection
        t.after(() => req.destroy())
        req.write('private')
        await until(() => stat(join(share, UPLOAD_TEMP_PREFIX + name)).then(s => s.size === 7, () => false))
        req.destroy()
        await assertPrivate(UPLOAD_TEMP_PREFIX + name, other)
        await until(async () => {
            const response = await send('/' + name + '?resume=7', owner, { method: 'PUT', body: '-done' })
            await response.text()
            assert.ok([200, 409].includes(response.status))
            return response.status === 200
        })
        assert.equal(await (await send('/' + name, other)).text(), 'private-done')
    })

    await t.test('final publication stays private until metadata has completed', async () => {
        const script = `exports.init = () => {
            const fs = require('fs/promises'), original = fs.rename
            let release, waiting = false
            fs.rename = async (...args) => {
                await original(...args)
                if (args[1].endsWith('publication.txt')) {
                    waiting = true
                    await new Promise(resolve => { release = resolve })
                }
            }
            exports.customRest = { publication_gate: ({ resume }) => {
                if (resume) release?.()
                return { waiting }
            } }
            return () => { release?.(); fs.rename = original }
        }`
        await api('set_config', { values: { server_code: script } }, admin)
        await until(() => api('_publication_gate', {}, admin).then(() => true, () => false))
        const publishing = send('/publication.txt', owner, { method: 'PUT', body: 'publication' })
        try {
            await until(() => api('_publication_gate', {}, admin).then(result => result.waiting))
            assert.equal((await send('/publication.txt', other)).status, 404)
            assert.equal(await (await send('/publication.txt', owner)).text(), 'publication')
            assert.equal(await (await send('/publication.txt', admin)).text(), 'publication')
            await api('_publication_gate', { resume: true }, admin)
            assert.equal((await publishing).status, 200)
            assert.equal(await (await send('/publication.txt', other)).text(), 'publication')
        }
        finally {
            await api('set_config', { values: { server_code: '' } }, admin)
            await publishing
        }
    })

    await t.test('a queued ZIP entry cannot read a private replacement inode', async () => {
        const blocker = await open(join(share, 'blocker.txt'), 'w')
        await blocker.truncate(64 * 1024 * 1024)
        await blocker.close()
        await writeFile(join(share, 'zip-public.txt'), 'public-data-00')
        const script = `exports.init = () => {
            const fs = require('fs/promises'), original = fs.rename
            let release, waiting = false
            fs.rename = async (...args) => {
                await original(...args)
                if (args[1].endsWith('zip-public.txt')) {
                    waiting = true
                    await new Promise(resolve => { release = resolve })
                }
            }
            exports.customRest = { zip_publication: ({ resume }) => {
                if (resume) release?.()
                return { waiting }
            } }
            return () => { release?.(); fs.rename = original }
        }`
        await api('set_config', { values: { server_code: script } }, admin)
        await until(() => api('_zip_publication', {}, admin).then(() => true, () => false))
        const req = request(base + '/?get=zip&list=blocker.txt//zip-public.txt', { headers: other })
        const response = once(req, 'response')
        req.end()
        const [res] = await response
        res.pause()
        assert.equal(res.statusCode, 200)
        const publishing = send('/zip-public.txt?existing=overwrite', owner, { method: 'PUT', body: 'private-data-0' })
        let tail = Buffer.alloc(0)
        try {
            await until(() => api('_zip_publication', {}, admin).then(result => result.waiting))
            assert.equal((await send('/zip-public.txt', other)).status, 404)
            const ended = new Promise<void>(resolve => {
                res.on('data', chunk => { tail = Buffer.concat([tail, chunk]).subarray(-65536) })
                res.on('error', () => {}) // an inode changed after archive enumeration, so aborting the archive is valid
                res.once('close', resolve)
            })
            res.resume()
            await ended
            assert.ok(!tail.includes(Buffer.from('private-data-0')), 'ZIP read private bytes through its previously authorized public pathname')
        }
        finally {
            req.destroy()
            await api('set_config', { values: { server_code: '' } }, admin)
            await publishing
            await rm(join(share, 'blocker.txt'))
        }
    })

    await t.test('a direct read cannot open an inode replaced after its stat', async () => {
        await writeFile(join(share, 'direct-public.txt'), 'public-data-00')
        const script = `exports.init = () => {
            const fs = require('fs'), fsp = require('fs/promises'), oldStat = fs.stat, oldRename = fsp.rename
            let releaseStat, releaseRename, statWaiting = false, renameWaiting = false
            fs.stat = (path, ...args) => {
                const callback = args.pop()
                oldStat(path, ...args, (error, stats) => {
                    if (String(path).endsWith('direct-public.txt') && !statWaiting) {
                        statWaiting = true
                        releaseStat = () => callback(error, stats)
                    }
                    else callback(error, stats)
                })
            }
            fsp.rename = async (...args) => {
                await oldRename(...args)
                if (args[1].endsWith('direct-public.txt')) {
                    renameWaiting = true
                    await new Promise(resolve => { releaseRename = resolve })
                }
            }
            exports.customRest = { direct_race: ({ resumeStat }) => {
                if (resumeStat) releaseStat?.()
                return { statWaiting, renameWaiting }
            } }
            return () => { releaseStat?.(); releaseRename?.(); fs.stat = oldStat; fsp.rename = oldRename }
        }`
        await api('set_config', { values: { server_code: script } }, admin)
        await until(() => api('_direct_race', {}, admin).then(() => true, () => false))
        const reading = send('/direct-public.txt', other).catch(error => {
            assert.equal(error.cause?.code, 'UND_ERR_SOCKET') // headers may already be committed when a changed inode aborts the stream
            return undefined
        })
        await until(() => api('_direct_race', {}, admin).then(result => result.statWaiting))
        const publishing = send('/direct-public.txt?existing=overwrite', owner, { method: 'PUT', body: 'private-data-0' })
        try {
            await until(() => api('_direct_race', {}, admin).then(result => result.renameWaiting))
            await api('_direct_race', { resumeStat: true }, admin)
            const response = await reading
            if (response) {
                assert.equal(response.status, 404)
                assert.ok(!(await response.text()).includes('private-data-0'))
            }
        }
        finally {
            await api('set_config', { values: { server_code: '' } }, admin)
            await publishing
        }
    })

    await t.test('anonymous ownership follows the session rather than the shared IP', async () => {
        const first = await anonymousSession()
        const second = await anonymousSession()
        const name = 'anonymous.txt'
        assert.equal((await send('/' + name + '?partial=20', first, { method: 'PUT', body: 'anonymous' })).status, 204)
        await assertPrivate(UPLOAD_TEMP_PREFIX + name, second)
        await assertPrivate(UPLOAD_TEMP_PREFIX + name, {})
        assert.equal(await (await send('/' + UPLOAD_TEMP_PREFIX + name, first)).text(), 'anonymous')
        assert.equal((await send('/' + name + '?get=' + UPLOAD_TEMP_HASH, first)).status, 200)
        assert.equal((await send('/' + name + '?get=' + UPLOAD_TEMP_HASH, second)).status, 404)
        assert.equal((await send('/' + name + '?resume=9', first, { method: 'PUT', body: '-done' })).status, 200)
        assert.equal(await (await send('/' + name, second)).text(), 'anonymous-done')
    })

    await t.test('normal read/list/archive permissions and upload-only hashing still apply to the owner', async () => {
        await api('set_vfs', { uri: '/', props: { masks: {
            [temp]: { can_see: false, can_read: false, can_archive: false },
        } } }, admin)
        assert.equal((await send('/' + temp, owner)).status, 403)
        const listing = await api('get_file_list', {}, owner)
        assert.ok(!listing.list.some((entry: { n: string }) => entry.n === temp))
        assert.equal((await send('/file.txt?get=' + UPLOAD_TEMP_HASH, owner)).status, 200)
        await api('set_vfs', { uri: '/', props: { masks: { '*.txt': { can_read: true, can_see: true } } } }, admin)
    })

    await t.test('long names and physical ownership survive restart', async () => {
        const name = 'long-'.repeat(43) + '.txt'
        const temporary = UPLOAD_TEMP_PREFIX + name.slice(-200)
        assert.equal((await send('/' + name + '?partial=20', owner, { method: 'PUT', body: 'long-private' })).status, 204)
        child.kill('SIGTERM')
        await stopped
        const storage = new KvStorage<Record<string, string | Date | null>>()
        await storage.open(join(cwd, 'upload-owners.kv'))
        // older ownership databases lack the physical source field
        const legacyKey = '/' + temp
        const legacy = await storage.get(legacyKey)
        assert.ok(legacy)
        delete legacy.unfinishedSource
        await storage.put(legacyKey, { ...legacy })
        await storage.close()
        await start()
        assert.equal(await (await send('/alias/' + temp, owner)).text(), 'private')
        assert.equal((await send('/alias/file.txt?resume=7&partial=20', owner, { method: 'PUT', body: '-legacy' })).status, 204)
        await assertPrivate(temporary, other)
        assert.equal(await (await send('/alias/' + temporary, owner)).text(), 'long-private')
        assert.equal((await send('/' + name + '?get=' + UPLOAD_TEMP_HASH, owner)).status, 200)
        assert.equal(await (await send('/alias/' + temp, owner)).text(), 'private-legacy')
        assert.equal(await (await send('/' + UPLOAD_TEMP_PREFIX + 'report.txt', other)).text(), 'complete')
    })

    await t.test('unknown temporary files are admin only', async () => {
        const name = UPLOAD_TEMP_PREFIX + 'orphan.txt'
        await writeFile(join(share, name), 'orphan')
        await assertPrivate(name, owner)
        assert.equal(await (await send('/' + name, admin)).text(), 'orphan')
        assert.equal((await send('/orphan.txt?get=' + UPLOAD_TEMP_HASH, owner)).status, 404)
    })

    await t.test('ownership storage failure leaves unfinished content admin only', async () => {
        const script = `exports.init = () => {
            const { uploadOwners } = require('./uploadOwners'), original = uploadOwners.put
            uploadOwners.put = function(key, ...args) {
                return key.endsWith('storage-failure.txt') ? Promise.reject(Error('injected ownership failure'))
                    : original.call(this, key, ...args)
            }
            exports.customRest = { visibility_ready: () => ({}) }
            return () => { uploadOwners.put = original }
        }`
        await api('set_config', { values: { server_code: script } }, admin)
        await until(() => api('_visibility_ready', {}, admin).then(() => true, () => false))
        try {
            assert.equal((await send('/storage-failure.txt?partial=20', owner, { method: 'PUT', body: 'private' })).status, 204)
            assert.equal((await send('/' + UPLOAD_TEMP_PREFIX + 'storage-failure.txt', owner)).status, 404)
            assert.equal(await (await send('/' + UPLOAD_TEMP_PREFIX + 'storage-failure.txt', admin)).text(), 'private')
        }
        finally { await api('set_config', { values: { server_code: '' } }, admin) }
    })

    async function assertPrivate(name: string, headers: Record<string, string>) {
        for (const path of ['/' + name, '/alias/' + name, '/' + name + '?get=icon']) {
            const response = await send(path, headers)
            assert.equal(response.status, 404, path + ': ' + await response.text())
        }
        assert.equal((await send('/' + name, headers, { method: 'HEAD' })).status, 404)
        const listing = await api('get_file_list', {}, headers)
        assert.ok(!listing.list.some((entry: { n: string }) => entry.n.includes(name)))
        assert.ok(!(await (await send('/?get=list&depth=*', headers)).text()).includes(name))
        const dav = await send('/', headers, { method: 'PROPFIND', headers: { depth: 'infinity' } })
        assert.equal(dav.status, 207)
        assert.ok(!(await dav.text()).includes(name))
        assert.equal((await send('/' + name, headers, { method: 'PROPFIND', headers: { depth: '0' } })).status, 404)
        for (const suffix of ['', '&list=' + encodeURIComponent(name)]) {
            const response = await send('/?get=zip' + suffix, headers)
            assert.equal(response.status, 200)
            const files = (await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()))).files
            assert.ok(!files.some(file => file.path.includes(name)))
        }
        const details = await api('get_file_details', { uris: ['/' + name] }, headers)
        assert.deepEqual(details.details, [false])
    }

    async function anonymousSession() {
        const response = await send(API_URI + 'refresh_session', {}, { headers: { 'x-hfs-anti-csrf': '1' } })
        assert.equal(response.status, 200)
        await response.text()
        return { cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
    }

    async function start() {
        output = ''
        child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--cwd', cwd, '--no-central'], {
            cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, COOKIE_SIGN_KEYS: 'unfinished-upload-test' },
        })
        stopped = once(child, 'exit')
        child.stdout!.on('data', chunk => output += chunk)
        child.stderr!.on('data', chunk => output += chunk)
        await until(() => {
            base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
            return Boolean(base)
        })
    }

    function send(path: string, headers: Record<string, string>, init: RequestInit={}) {
        return fetch(base + path, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(5000) })
    }

    async function api(name: string, params: object, headers: Record<string, string>) {
        const response = await send(API_URI + name, headers, {
            method: 'POST', body: JSON.stringify(params), headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
        })
        assert.equal(response.status, 200, await response.clone().text())
        return response.json()
    }

    async function until(check: () => boolean | Promise<boolean>) {
        for (let i = 0; i < 200; i++) {
            if (await check()) return
            assert.equal(child.exitCode, null, output)
            await delay(50)
        }
        assert.fail(output)
    }

    function credentials(username: string) {
        return { authorization: 'Basic ' + Buffer.from(username + ':secret').toString('base64') }
    }
})
