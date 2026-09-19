import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('plugin source discards malformed changelogs and invalid entries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-plugin-changelog-'))
    try {
        // plugins imports the server; isolate its startup side effects from the test runner
        const child = spawnSync(process.execPath, ['-e', `
            process.argv = [process.execPath, 'test', '--cwd', ${JSON.stringify(cwd)}]
            const assert = require('node:assert/strict')
            require(${JSON.stringify(resolve('dist/src'))})
            const { parsePluginSource } = require(${JSON.stringify(resolve('dist/src/plugins'))})
            const parse = value => parsePluginSource('test-plugin', 'exports.changelog = ' + value)
            for (const value of ['undefined', 'null', '{}', '"text"', '[broken'])
                assert.equal('changelog' in parse(value), false)
            assert.deepEqual(parse('[]').changelog, [])
            const valid = { version: 1.5, message: 'fixed' }
            const mixed = JSON.stringify([valid, null, {}, 42, 'text',
                { version: '2', message: 'wrong type' }, { version: 2 },
                { version: 3, message: false }, { version: 4, message: '' }])
            assert.deepEqual(parse(mixed).changelog, [valid, { version: 4, message: '' }])
            assert.deepEqual(parse('[{"version":1e400,"message":"infinite"}]').changelog, [])
            process.exit(0)
        `], { cwd, encoding: 'utf8', timeout: 10_000 })
        assert.equal(child.status, 0, child.error?.message || child.stderr || child.stdout)
    }
    finally {
        await rm(cwd, { recursive: true, force: true })
    }
})
