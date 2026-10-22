import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { warnIfUnicodePathError } from '../src/filePathErrors'

test('Unicode path diagnosis reads the directory only after macOS ENOENT and preserves the error', async t => {
    let names = ['cafe\u0301.mp3']
    const reads = t.mock.method(fs, 'readdir', async () => names)
    const warnings = t.mock.method(console, 'warn', () => {})
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    await warnIfUnicodePathError(Object.assign(new Error('denied'), { code: 'EACCES' }), '/music/cafe\u0301.mp3')
    await warnIfUnicodePathError(missing, '/music/missing.mp3')
    assert.equal(reads.mock.callCount(), 0)
    for (const name of ['cafe\u0301.mp3', 'caf\u00e9.mp3'])
        await warnIfUnicodePathError(missing, '/music/' + name)
    const expected = process.platform === 'darwin' ? 2 : 0
    assert.equal(reads.mock.callCount(), expected)
    assert.equal(warnings.mock.callCount(), expected)
    if (expected)
        assert.ok(String(warnings.mock.calls[0]!.arguments[0]).includes('https://github.com/rejetto/hfs/wiki/Troubleshooting#macos-smb-unicode-filenames-not-working'))
    assert.equal(missing.code, 'ENOENT')
    names = []
    await warnIfUnicodePathError(missing, '/music/cafe\u0301.mp3')
    reads.mock.mockImplementation(async () => { throw Error('offline') })
    await warnIfUnicodePathError(missing, '/music/cafe\u0301.mp3')
    assert.equal(warnings.mock.callCount(), expected)
})

test('Unicode path diagnosis matches Japanese canonical equivalents but not compatibility equivalents', async t => {
    const decomposed = '05. ヒ\u309aタコ\u3099ラスPYTHAGORAS.mp3'
    let names = [decomposed, decomposed.normalize('NFC')]
    t.mock.method(fs, 'readdir', async () => names)
    const warnings = t.mock.method(console, 'warn', () => {})
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    for (const name of names)
        await warnIfUnicodePathError(missing, '/music/' + name)
    const expected = process.platform === 'darwin' ? 2 : 0
    assert.equal(warnings.mock.callCount(), expected)
    if (expected)
        assert.equal(warnings.mock.calls[0]!.arguments[1], '/music/' + decomposed)
    names = ['unrelated.mp3']
    await warnIfUnicodePathError(missing, '/music/' + decomposed)
    names = ['\u00c5.mp3']
    await warnIfUnicodePathError(missing, '/music/\uff21\u030a.mp3')
    assert.equal(warnings.mock.callCount(), expected)
})
