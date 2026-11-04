import test from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { basename } from 'node:path'

test('plugin catalog persists complete searches, shares refreshes and reuses unchanged metadata', async t => {
    let now = 1_000_000_000
    t.mock.method(Date, 'now', () => now)
    let saved: object | undefined
    let version = '1'
    let requests = 0
    let reads = 0
    let fail = false
    let blocked = false
    let release: (() => void) | undefined
    let repositories = [repo('alice/one'), repo('bob/two')]
    const storage = {
        ready: async () => {}, get: async () => saved,
        put: async (_key: string, value: object) => {
            assert.equal(typeof value, 'object')
            saved = structuredClone(value)
        },
    }
    const github = {
        async *apiGithubPaginated(uri: string, options: { requireComplete: boolean }) {
            assert.equal(uri, 'search/repositories?q=topic:hfs-plugin')
            assert.equal(options.requireComplete, true)
            requests++
            if (blocked) await new Promise<void>(resolve => { release = resolve })
            if (fail) throw Error('network failure')
            yield* repositories
        },
        async readOnlineCompatiblePlugin(id: string) {
            reads++
            return { id, description: 'A useful plugin', apiRequired: 1, version: reads }
        },
        async getProjectInfo() { return { repo_blacklist: { 'blocked/plugin': { message: 'blocked' } } } },
    }
    const original = (Module as any)._load
    t.mock.method(Module as any, '_load', function (id: string, parent: { filename: string }, ...rest: unknown[]) {
        if (basename(parent.filename) === 'pluginCatalog.ts') {
            if (id === './github') return github
            if (id === './persistence') return { storedMap: storage }
            if (id === './const') return { get VERSION() { return version } }
        }
        return original.call(this, id, parent, ...rest)
    })
    t.after(() => { delete require.cache[require.resolve('../src/pluginCatalog')] })
    let api = load()
    const initial = await collect()
    assert.equal(initial.length, 1)
    assert.equal(reads, 2)
    assert.equal((await api.searchPluginCatalog(initial[0], 'ALICE'))[0].repo, 'alice/one')
    assert.equal((await api.searchPluginCatalog(initial[0], '', ['alice/one'])).length, 1)
    const filtered = await api.searchPluginCatalog(initial[0])
    filtered[0].description = 'mutated by API'
    assert.equal((await api.searchPluginCatalog(initial[0]))[0].description, 'A useful plugin')
    api = load() // persisted data survives a new module instance
    await collect()
    assert.equal(requests, 1)
    now += 5 * 60_000
    blocked = true
    const first = api.getPluginCatalog()
    const second = api.getPluginCatalog()
    assert.equal((await first.next()).value.refreshing, true)
    assert.equal((await second.next()).value.entries.length, 2)
    const firstRefresh = first.next()
    const secondRefresh = second.next()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests, 2)
    release!()
    await Promise.all([firstRefresh, secondRefresh])
    assert.equal(reads, 2)
    blocked = false
    now += 5 * 60_000
    repositories = [{ ...repo('alice/one'), pushed_at: 'changed' }, repo('carol/three')]
    const refreshed = await collect()
    assert.equal(reads, 4)
    assert.deepEqual(refreshed.at(-1).entries.map((x: any) => x.repository.full_name), ['alice/one', 'carol/three'])
    now += 5 * 60_000
    repositories[0]!.default_branch = 'other'
    await collect()
    assert.equal(reads, 5)
    const good = saved
    now += 5 * 60_000
    fail = true
    const failed = api.getPluginCatalog()
    assert.equal((await failed.next()).value.refreshing, true)
    await assert.rejects(failed.next(), /network failure/)
    assert.equal(saved, good)
    now += 24 * 60 * 60_000
    await assert.rejects(api.getPluginCatalog().next(), /network failure/) // expired data isn't shown
    fail = false
    version = '2'
    const upgraded = await collect()
    assert.equal(upgraded.length, 1)
    assert.equal(reads, 7) // recalculate compatibility after an HFS upgrade

    function load() {
        delete require.cache[require.resolve('../src/pluginCatalog')]
        return require('../src/pluginCatalog')
    }
    async function collect() {
        const snapshots = []
        for await (const snapshot of api.getPluginCatalog()) snapshots.push(snapshot)
        return snapshots
    }
    function repo(full_name: string) {
        return { full_name, pushed_at: 'original', default_branch: 'main', description: '', stargazers_count: 0, license: null }
    }
})
