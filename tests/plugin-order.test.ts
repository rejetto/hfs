import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('beforePlugin and afterPlugin accept plugin repositories', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-plugin-order-'))
    try {
        // plugins imports the server; isolate its startup side effects from the test runner
        const child = spawnSync(process.execPath, ['-e', `
            process.argv = [process.execPath, 'test', '--cwd', ${JSON.stringify(cwd)}, '--no-central']
            const assert = require('node:assert/strict')
            require(${JSON.stringify(resolve('dist/src'))})
            const { Plugin, mapPlugins } = require(${JSON.stringify(resolve('dist/src/plugins'))})
            const add = (id, data = {}) => new Plugin(id, '', data, () => {})
            const order = prefix => mapPlugins((_plugin, id) => id, false).filter(id => id.startsWith(prefix))

            add('before-target', { repo: 'owner/target' })
            add('before-source', { beforePlugin: 'owner/target' })
            assert.deepEqual(order('before-'), ['before-source', 'before-target'])

            add('after-source', { afterPlugin: 'https://plugins.example/target.js' })
            add('after-target', { repo: { main: 'https://plugins.example/target.js' } })
            assert.deepEqual(order('after-'), ['after-target', 'after-source'])

            add('id-source', { afterPlugin: 'id-target' })
            add('id-target')
            assert.deepEqual(order('id-'), ['id-target', 'id-source'])

            add('missing-first')
            add('missing-source', { beforePlugin: 'owner/missing' })
            add('missing-last')
            assert.deepEqual(order('missing-'), ['missing-first', 'missing-source', 'missing-last'])

            add('collision-repo-owner', { repo: 'collision-target' })
            add('collision-target')
            add('collision-source', { beforePlugin: 'collision-target' })
            assert.deepEqual(order('collision-'), ['collision-repo-owner', 'collision-source', 'collision-target'])
            process.exit(0)
        `], { cwd, encoding: 'utf8', timeout: 10_000 })
        assert.ifError(child.error)
        assert.equal(child.status, 0, child.error?.message || child.stderr || child.stdout)
    }
    finally {
        await rm(cwd, { recursive: true, force: true })
    }
})
