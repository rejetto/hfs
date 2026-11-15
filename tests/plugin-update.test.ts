import test from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { basename } from 'node:path'

for (const state of ['running', 'stopped', 'startup-error']) {
    test(`updating a ${state} plugin waits for restart without enabling stopped plugins`, async t => {
        let running = state !== 'stopped'
        let restartCalled = false
        let downloaded = false
        let complete = false
        let release: () => void = () => {}
        const restarted = new Promise<void>(resolve => release = resolve)
        const plugins = {
            getPluginInfo: () => ({ id: 'dependency', repo: 'test/dependency' }),
            getMissingDependencies: () => [],
            isPluginRunning: () => running,
            async waitPluginRunning(id: string) {
                assert.equal(id, 'dependency')
                assert.equal(downloaded, true)
                restartCalled = true
                await restarted
                if (state === 'startup-error') throw Error('startup failed')
                running = true
            },
        }
        const github = {
            readOnlineCompatiblePlugin: async () => ({ version: 2, branch: 'main' }),
            async downloadPlugin() {
                downloaded = true
                running = false
            },
        }
        const loader = Module as typeof Module & {
            _load(id: string, parent: { filename: string }, ...rest: unknown[]): unknown
        }
        const original = loader._load
        t.mock.method(loader, '_load', function (this: unknown, id: string, parent: { filename: string }, ...rest: unknown[]) {
            if (basename(parent.filename) === 'api.plugins.ts') {
                if (id === './plugins') return plugins
                if (id === './github') return github
                if (id === './misc') return { apiAssertTypes() {} }
                if (id.startsWith('./')) return {}
            }
            return original.call(this, id, parent, ...rest)
        })
        const path = require.resolve('../src/api.plugins')
        delete require.cache[path]
        t.after(() => { delete require.cache[path] })
        const apis: typeof import('../src/api.plugins').default = require(path).default
        const updating = Promise.resolve(apis.update_plugin({ id: 'dependency' }, {} as never))
            .then(result => { complete = true; return result })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(downloaded, true)
        assert.equal(restartCalled, state !== 'stopped')
        assert.equal(complete, state === 'stopped')
        release()
        assert.deepEqual(await updating, {})
        assert.equal(running, state === 'running')
    })
}
