import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { XMLValidator } from 'fast-xml-parser'

test('PROPFIND streams with backpressure and cancels traversal', { timeout: 30000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-webdav-streaming-'))
    const share = join(cwd, 'share')
    await mkdir(join(share, 'huge'), { recursive: true })
    await mkdir(join(share, 'empty'))
    await mkdir(join(share, 'normal', 'nested'), { recursive: true })
    await writeFile(join(share, 'normal', 'a&b.txt'), 'content')
    await writeFile(join(share, 'normal', 'nested', 'deep.txt'), 'deep')
    await writeFile(join(share, 'normal', 'private.txt'), 'private')
    const nested = Array.from({ length: 24 }, () => 'd')
    const deepRoot = join(share, 'deep')
    const leaf = join(deepRoot, ...nested)
    await mkdir(leaf, { recursive: true })
    const leafNames = Array.from({ length: 350 }, (_, i) => i + '-' + 'è'.repeat(60) + '.txt')
    for (const name of leafNames)
        await writeFile(join(leaf, name), '')
    const scratch = join(cwd, 'scratch')
    await mkdir(scratch)
    const hasCycle = process.platform !== 'win32'
    if (hasCycle)
        await symlink(deepRoot, join(leaf, 'loop'))
    await mkdir(join(cwd, 'plugins', 'streaming'), { recursive: true })
    await writeFile(join(cwd, 'plugins', 'streaming', 'plugin.js'), `
exports.apiRequired = 1
exports.init = api => {
    let produced = 0, virtualProduced = 0, active = 0, closed = false, release
    const emptyEntries = Array.from({ length: 1000 }, (_, i) => ({ name: 'empty-' + i, isDirectory: () => true,
        stats: { mtime: new Date(0), birthtime: new Date(0), isDirectory: () => true } }))
    const gate = new Promise(resolve => release = resolve)
    api.events.on('listDiskFolder', ({ path, ctx }) => {
        if (ctx?.recordListing && path === ${JSON.stringify(leaf)})
            return item => { if (typeof item === 'boolean') ctx.completed = item }
        if (path.endsWith('nested') && ctx?.query.handleLimit)
            return (function* () { throw Object.assign(Error('directory handles exhausted'), { code: 'EMFILE' }) })()
        if (path.endsWith('huge')) return entries(Number(ctx.query.total) || 50000)
        if (path.endsWith('empty')) return emptyEntries
        if (api.require('path').basename(path).startsWith('empty-')) return []
    })
    api.events.on('checkVfsPermission', ({ node, perm }) => {
        if (perm === 'can_see' && node.parent?.name === 'virtual') virtualProduced++
    })
    return { async middleware(ctx) {
        if (ctx.path === '/state') { ctx.body = { produced, virtualProduced, closed }; ctx.stop() }
        if (ctx.path === '/release') { release(); ctx.body = 'released'; ctx.stop() }
        if (ctx.path === '/empty-state') {
            ctx.body = await Promise.all(emptyEntries.slice(0, -1).map(entry => entry.closingBranch))
            ctx.stop()
        }
        if (ctx.path === '/first-probed-child') {
            const fs = api.require('fs/promises')
            const { walkNode } = api.require('./vfs')
            const access = fs.access
            // hold the first mount long enough to observe which sibling the walker emits first
            fs.access = async path => {
                if (path === 'slow-mount') await new Promise(resolve => setTimeout(resolve, 250))
                else await access(path)
            }
            const walker = walkNode({ vfsPath: '/', children: [
                { name: 'slow', source: 'slow-mount' }, { name: 'local' },
            ] }, { depth: 0 })
            try { ctx.body = (await walker.next()).value.name }
            finally { fs.access = access; await walker.return() }
            ctx.stop()
        }
        if (ctx.path === '/deep-state') {
            ctx.body = await walkDeepTree(Boolean(ctx.query.abort))
            ctx.stop()
        }
    } }
    async function walkDeepTree(abort) {
        const { walkDir } = api.require('./walkDir')
        const fs = api.require('fs/promises')
        const opendir = fs.opendir, mkdtemp = fs.mkdtemp
        let snapshots = 0
        const ctx = { recordListing: true, query: {}, isAborted: () => abort && snapshots > 0 }
        fs.mkdtemp = async (...args) => {
            const folder = await mkdtemp(...args)
            snapshots++
            return folder
        }
        let open = 0, peak = 0
        fs.opendir = async (...args) => {
            const dir = await opendir(...args)
            open++
            peak = Math.max(peak, open)
            const iterate = dir[Symbol.asyncIterator].bind(dir)
            dir[Symbol.asyncIterator] = async function* () {
                try { yield* iterate() }
                finally { open-- }
            }
            return dir
        }
        const paths = [], ended = []
        try {
            await walkDir(${JSON.stringify(deepRoot)}, { ctx, depth: Infinity, onDirectoryEnd: path => ended.push(path) },
                entry => { paths.push(entry.path) })
            return { peak, open, paths, ended, snapshots, completed: ctx.completed }
        }
        finally {
            fs.opendir = opendir
            fs.mkdtemp = mkdtemp
        }
    }
    async function* entries(total) {
        active++
        closed = false
        try {
            for (let i = 0; i < total; i++) {
                if (i === 64) await gate
                produced++
                yield { name: i + '-'.repeat(1024), isDirectory: () => false,
                    stats: { size: 1, mtime: new Date(0), birthtime: new Date(0), isDirectory: () => false, isFile: () => true } }
            }
        }
        finally { closed = --active === 0 }
    }
}
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, enable_plugins: ['streaming'], log: '', error_log: '',
        force_webdav_login: false, webdav_initial_auth: false,
        vfs: { source: share, children: [
            { name: 'normal', source: join(share, 'normal'), masks: { 'private.txt': { can_see: false } } },
            { name: 'virtual', children: Array.from({ length: 5000 }, (_, i) => ({
                name: i + '-'.repeat(1024), isFolder: true, see_without_probing: true,
            })) },
        ] },
    }))
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--cwd', cwd, '--no-central'], {
        cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
    })
    const stopped = once(child, 'exit')
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    t.after(async () => {
        child.kill('SIGKILL')
        await stopped
        await rm(cwd, { recursive: true, force: true, maxRetries: 5 })
    })
    await until(() => {
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        assert.equal(child.exitCode, null, output)
        return Boolean(base)
    })
    await until(() => state().then(() => true, () => false))
    const stalled = []
    for (let i = 0; i < 3; i++) stalled.push(await pause('/huge/'))
    assert.equal((await state()).closed, false, 'response starts before traversal finishes')
    await (await fetch(base + '/release')).text()
    await delay(300)
    let previous = -1, stable = 0
    await until(async () => {
        const { produced } = await state()
        stable = produced === previous ? stable + 1 : 0
        previous = produced
        return stable >= 3
    })
    assert.ok(previous < 50000, 'a stalled consumer must pause the directory producer')
    const ordinary = await fetch(base + '/normal/', {
        method: 'PROPFIND', headers: { depth: '1' }, signal: AbortSignal.timeout(2000),
    })
    assert.equal((await ordinary.text()).match(/<D:response>/g)?.length, 3,
        'stalled requests must not occupy another listing’s workers')
    for (const req of stalled) req.destroy()
    await until(async () => (await state()).closed)
    const cancelled = (await state()).produced
    await delay(100)
    assert.equal((await state()).produced, cancelled)
    const completed = await fetch(base + '/huge/?total=200', { method: 'PROPFIND', headers: { depth: '1' } })
    const completeXml = await completed.text()
    assert.equal(XMLValidator.validate(completeXml), true)
    assert.equal((completeXml.match(/<D:response>/g) || []).length, 201, 'all results survive repeated backpressure')
    const virtual = await pause('/virtual/')
    await delay(500)
    assert.ok((await state()).virtualProduced < 5000, 'explicit VFS children must also respect backpressure')
    virtual.destroy()
    await delay(100)
    const virtualCancelled = (await state()).virtualProduced
    await delay(100)
    assert.equal((await state()).virtualProduced, virtualCancelled)
    const empty = await fetch(base + '/empty/', { method: 'PROPFIND', headers: { depth: 'infinity' } })
    assert.equal((await empty.text()).match(/<D:response>/g)?.length, 1001)
    const branches = await (await fetch(base + '/empty-state')).json()
    assert.equal(branches.length, 999)
    for (const [index, branch] of branches.entries())
        assert.equal(branch, 'empty-' + index, 'empty siblings must not retain duplicate completion notifications')
    assert.equal(await (await fetch(base + '/first-probed-child')).text(), 'local')
    const { peak, open, paths, ended, snapshots, completed: listingComplete } = await (await fetch(base + '/deep-state')).json()
    assert.equal(snapshots, 1, 'only the wide leaf needs a temporary file')
    assert.equal(listingComplete, true)
    const aborted = await (await fetch(base + '/deep-state?abort=1')).json()
    assert.equal(aborted.completed, false, 'a plugin must discard a listing cancelled during its snapshot')
    assert.equal(aborted.open, 0)
    assert.ok(peak > 0 && peak < nested.length, 'deep walks must not keep an open handle at every level')
    assert.equal(open, 0)
    const deepFiles = paths.filter((path: string) => path.endsWith('.txt')).sort()
    assert.deepEqual(deepFiles, leafNames.map(name => [...nested, name].join('/')).sort())
    assert.deepEqual((await readdir(scratch)).filter(name => name.startsWith('hfs-directory-')), [])
    if (hasCycle) {
        const loop = [...nested, 'loop'].join('/')
        assert.ok(paths.includes(loop), 'a cyclic symlink itself remains visible')
        assert.equal(ended.filter((path: string) => path === loop).length, 1, 'a skipped branch must release its VFS state')
    }

    for (const [depth, expected] of [['0', 1], ['1', 3], ['infinity', 4]] as const) {
        const res = await fetch(base + '/normal/', { method: 'PROPFIND', headers: { depth } })
        const xml = await res.text()
        assert.equal(res.status, 207)
        assert.equal(XMLValidator.validate(xml), true)
        assert.equal((xml.match(/<D:response>/g) || []).length, expected, depth + ': ' + xml)
        assert.ok(!xml.includes('private.txt'))
        if (depth !== '0') assert.ok(xml.includes('a&amp;b.txt'), xml)
        assert.equal(xml.includes('nested/deep.txt'), depth === 'infinity')
    }
    for (const encoding of ['identity', 'gzip'])
        await assert.rejects(async () => {
            const res = await fetch(base + '/normal/?handleLimit=1', {
                method: 'PROPFIND', headers: { depth: 'infinity', 'accept-encoding': encoding }, signal: AbortSignal.timeout(2000),
            })
            await res.text()
        }, TypeError, 'a directory handle error must interrupt the listing even with compression')
    assert.doesNotMatch(output, /Uncaught:|Unhandled/)

    async function pause(path: string) {
        const req = request(base + path, { method: 'PROPFIND', headers: { depth: 'infinity' } })
        req.on('error', () => {}) // cancellation deliberately resets the connection
        t.after(() => req.destroy())
        const response = once(req, 'response', { signal: AbortSignal.timeout(3000) })
        req.end()
        const [incoming] = await response
        incoming.pause()
        assert.equal(incoming.statusCode, 207)
        return req
    }

    async function state(): Promise<{ produced: number, virtualProduced: number, closed: boolean }> {
        return (await fetch(base + '/state')).json()
    }

    async function until(check: () => boolean | Promise<boolean>) {
        for (let i = 0; i < 150; i++) {
            if (await check()) return
            await delay(50)
        }
        assert.fail(output)
    }
})
