import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { tryJson } from '../src/cross'

test('metadata reads use the fallback database when native attributes are unavailable', async () => {
    const source = readFileSync(resolve(__dirname, '../src/fileAttr.ts'), 'utf8')
    const block = source.slice(source.indexOf('export async function loadFileAttr('), source.indexOf('// remove file-attr'))
    const { outputText } = ts.transpileModule(block, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    for (const fsx of [undefined, { get: async () => { throw Error('unsupported filesystem') } }, { get: async () => null }]) {
        const meta = { approved: false }
        const entries = new Map<string, unknown>([['upload.html|uploader', meta], ['upload.html|comment', 'comment']])
        const exports = {} as Pick<typeof import('../src/fileAttr'), 'loadFileAttr'>
        let open = true
        runInNewContext(outputText, {
            exports, fsx, IS_WINDOWS: true, FILE_ATTR_PREFIX: 'user.hfs.', console,
            fileAttrKey: (path: string, key: string) => path + '|' + key,
            fileAttrDb: { isOpen: () => open, get: async (key: string) => entries.get(key) },
        })
        assert.equal(await exports.loadFileAttr('upload.html', 'uploader'), meta)
        assert.equal(await exports.loadFileAttr('upload.html', 'comment'), 'comment')
        assert.equal(await exports.loadFileAttr('local.html', 'uploader'), undefined)
        meta.approved = true
        assert.equal((await exports.loadFileAttr('upload.html', 'uploader')).approved, true)
        open = false
        assert.equal(await exports.loadFileAttr('upload.html', 'uploader'), undefined)
    }
    for (const value of ['{"approved":true}', '', null, 'null', 'invalid']) {
        const exports = {} as Pick<typeof import('../src/fileAttr'), 'loadFileAttr'>
        runInNewContext(outputText, {
            exports, tryJson, IS_WINDOWS: false, FILE_ATTR_PREFIX: 'user.hfs.',
            fsx: { get: async () => value },
            fileAttrDb: { isOpen: () => assert.fail('successful native reads must not use stale database attributes') },
        })
        const result = await exports.loadFileAttr('upload.html', 'uploader')
        assert.deepEqual(result, value === '{"approved":true}' ? { approved: true } : undefined)
    }
})

test('Windows metadata storage waits for timestamp restoration before returning', async () => {
    const source = readFileSync(resolve(__dirname, '../src/fileAttr.ts'), 'utf8')
    const block = source.slice(source.indexOf('export async function storeFileAttr('), source.indexOf('export async function loadFileAttr('))
    const { outputText } = ts.transpileModule(block, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    let nativeValue: string | undefined
    const entries = new Map([['upload.tmp|test', 'old value']])
    let release!: () => void
    const restoration = new Promise<void>(resolve => { release = resolve })
    const exports = {} as Pick<typeof import('../src/fileAttr'), 'storeFileAttr'>
    runInNewContext(outputText, {
        exports, IS_WINDOWS: true, FILE_ATTR_PREFIX: 'user.hfs.',
        statWithTimeout: async () => ({ atime: new Date(), mtime: new Date() }),
        fsx: { set: async (_path: string, _key: string, value: string) => { nativeValue = value } },
        utimes: () => restoration,
        fileAttrKey: (path: string, key: string) => path + '|' + key,
        fileAttrDb: { isOpen: () => true, has: (key: string) => entries.has(key), del: async (key: string) => entries.delete(key) },
    })
    let finished = false
    const storing = exports.storeFileAttr('upload.tmp', 'test', undefined).then(result => {
        finished = true
        return result
    })
    // a caller must not rename the file while Windows timestamp restoration is still pending
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(finished, false)
    release()
    assert.equal(await storing, true)
    assert.equal(nativeValue, 'null')
    assert.equal(entries.size, 0)
})
