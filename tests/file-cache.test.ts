import test from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { singleWorkerFromBatchWorker } from '../src/debounceAsync'

test('file cache: repeated missing files recover after 100 ms, and attributes skip descript.ion', async t => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'hfs-file-cache-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    let mode = '', attribute: string | undefined
    const paths = ['../src/util-files', '../src/comments'].map(path => require.resolve(path))
    const saved = paths.map(path => require.cache[path])
    for (const path of paths) delete require.cache[path]
    t.after(() => paths.forEach((path, i) => {
        delete require.cache[path]
        if (saved[i]) require.cache[path] = saved[i]
    }))
    // isolate config and attribute storage while exercising the real filesystem and cache
    const originalLoad = (Module as any)._load
    t.mock.method(Module as any, '_load', function (id: string, parent: { filename: string }, ...args: unknown[]) {
        const file = basename(parent.filename)
        if (['util-files.ts', 'comments.ts'].includes(file)) {
            if (id === './config') return { defineConfig: (key: string, value: unknown) => ({
                get: () => key === 'comments_storage' ? mode : value,
                compiled: () => key === 'comments_storage' ? mode !== 'attr' : 3000,
                sub() {},
            }) }
            if (id === './const') return { IS_WINDOWS: process.platform === 'win32' }
            if (id === './stat') return {}
        }
        if (file === 'comments.ts' && id === './misc')
            return { loadFileAttr: async () => attribute, singleWorkerFromBatchWorker }
        return originalLoad.call(this, id, parent, ...args)
    })
    const { loadFileCached, invalidateFileCache } = require('../src/util-files') as typeof import('../src/util-files')
    const { getCommentFor, setCommentFor } = require('../src/comments') as typeof import('../src/comments')
    const stat = fs.stat
    let checks = 0
    t.mock.method(fs, 'stat', (...args: Parameters<typeof stat>) => {
        checks++
        return stat(...args)
    })
    const missing = join(dir, 'missing.txt')
    const load = () => loadFileCached(missing, path => fs.readFile(path, 'utf8'))
    await assert.rejects(load, { code: 'ENOENT' })
    const initialChecks = checks
    for (let i = 0; i < 20; i++) await assert.rejects(load, { code: 'ENOENT' })
    assert.equal(checks, initialChecks)
    await fs.writeFile(missing, 'created')
    await delay(150)
    assert.equal((await load()).content, 'created')
    assert.ok(checks > initialChecks)
    assert.equal((await loadFileCached(missing, () => assert.fail('unchanged file was reloaded'))).content, 'created')
    await fs.rm(missing)
    await assert.rejects(load, { code: 'ENOENT' })
    await fs.writeFile(missing, 'recreated')
    invalidateFileCache(missing)
    assert.equal((await load()).content, 'recreated')

    const file = join(dir, 'file.txt')
    await fs.writeFile(file, '')
    await fs.writeFile(join(dir, 'descript.ion'), 'file.txt fallback comment\n')
    mode = 'attr+ion'
    attribute = 'attribute comment'
    const beforeAttribute = checks
    assert.equal(await getCommentFor(file), 'attribute comment')
    assert.equal(checks, beforeAttribute)
    attribute = undefined
    assert.equal(await getCommentFor(file), 'fallback comment')
    attribute = ''
    assert.equal(await getCommentFor(file), 'fallback comment')
    mode = ''
    attribute = 'ignored'
    assert.equal(await getCommentFor(file), 'fallback comment')
    assert.equal(await getCommentFor(), undefined)
    await setCommentFor(file, 'updated comment')
    assert.equal(await getCommentFor(file), 'updated comment')
    await setCommentFor(file, '')
    assert.equal(await getCommentFor(file), undefined)
    await setCommentFor(file, 'recreated comment')
    assert.equal(await getCommentFor(file), 'recreated comment')
})
