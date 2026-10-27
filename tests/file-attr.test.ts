import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('Windows metadata storage waits for timestamp restoration before returning', async () => {
    const source = readFileSync(resolve(__dirname, '../src/fileAttr.ts'), 'utf8')
    const block = source.slice(source.indexOf('export async function storeFileAttr('), source.indexOf('export async function loadFileAttr('))
    const { outputText } = ts.transpileModule(block, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    let release!: () => void
    const restoration = new Promise<void>(resolve => { release = resolve })
    const exports = {} as Pick<typeof import('../src/fileAttr'), 'storeFileAttr'>
    runInNewContext(outputText, {
        exports, IS_WINDOWS: true, FILE_ATTR_PREFIX: 'user.hfs.',
        statWithTimeout: async () => ({ atime: new Date(), mtime: new Date() }),
        fsx: { set: async () => {} }, utimes: () => restoration,
    })
    let finished = false
    const storing = exports.storeFileAttr('upload.tmp', 'test', 'value').then(result => {
        finished = true
        return result
    })
    // a caller must not rename the file while Windows timestamp restoration is still pending
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(finished, false)
    release()
    assert.equal(await storing, true)
})
