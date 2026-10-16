import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

test('listing prefetch preserves order, serial plugin hooks, filters and early limits', { timeout: 30000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-listing-prefetch-'))
    const groups = ['full', 'limited', 'filtered', 'sync']
    for (const group of groups) {
        await mkdir(join(cwd, group))
        for (let i = 0; i < 20; i++)
            await writeFile(join(cwd, group, `file${String(i).padStart(2, '0')}.txt`), String(i))
        await writeFile(join(cwd, group, 'file-hidden.txt'), 'hidden')
        await writeFile(join(cwd, group, 'file-skip.bin'), 'filtered')
    }
    await mkdir(join(cwd, 'plugins/probe'), { recursive: true })
    await writeFile(join(cwd, 'preload.cjs'), `
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { basename, dirname } = require('node:path');
const stat = fsp.stat;
const groups = ${JSON.stringify(groups)};
const metrics = Object.fromEntries(groups.map(g => [g, { started: [], active: 0, max: 0, hooks: [], activeHooks: 0, maxHooks: 0 }]));
global.listingProbe = { metrics, save };
function save() { fs.writeFileSync(${JSON.stringify(join(cwd, 'metrics.json'))}, JSON.stringify(metrics)) }
fsp.stat = async function(path, ...args) {
    const m = metrics[basename(dirname(String(path)))];
    if (!m || !basename(String(path)).startsWith('file')) return stat.call(this, path, ...args);
    m.started.push(basename(String(path))); m.active++; m.max = Math.max(m.max, m.active);
    try {
        const result = await stat.call(this, path, ...args);
        // uneven I/O latency exposes completion-order changes without a wall-clock assertion
        await new Promise(resolve => setTimeout(resolve, m.started.length === 1 ? 60 : 15));
        return result;
    }
    finally { m.active--; save() }
};
`)
    await writeFile(join(cwd, 'plugins/probe/plugin.js'), `
exports.description = 'listing order probe';
exports.version = 1;
exports.apiRequired = 1;
exports.init = api => {
    api.events.on('dirEntry', ({ entry, listUri }, extra) => {
        if (listUri !== '/sync/') return;
        entry.icon = 'event';
        if (entry.n === 'file07.txt') extra.preventDefault();
        if (entry.n === 'file08.txt') return Promise.resolve().then(() => extra.preventDefault());
    });
    require('node:fs').writeFileSync('probe-ready', '');
    return { onDirEntry({ entry, node }) {
        const { basename, dirname } = require('node:path');
        const { metrics, save } = global.listingProbe;
        const group = basename(dirname(node.source));
        const m = metrics[group];
        if (!m) return;
        if (group === 'sync') {
            m.hooks.push(entry.n); save(); entry.comment = 'legacy';
            if (entry.n === 'file03.txt') return false;
            if (entry.n === 'file04.txt') return { then(resolve) { setTimeout(() => resolve(false), 2) } };
            if (entry.n === 'file05.txt') throw Error('sync failure');
            if (entry.n === 'file06.txt') return Promise.reject(Error('async failure'));
            return;
        }
        m.activeHooks++; m.maxHooks = Math.max(m.maxHooks, m.activeHooks);
        return new Promise(resolve => setTimeout(resolve, 2)).then(() => {
            m.hooks.push(entry.n); m.activeHooks--; save();
        });
    } };
};
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '', enable_plugins: ['probe'], directory_cache: 0,
        vfs: { children: groups.map(name => ({ name, source: join(cwd, name), masks: { 'file-hidden.txt': { can_see: false } } })) },
    }))
    const child = spawn(process.execPath, ['--require', join(cwd, 'preload.cjs'), resolve(__dirname, '../dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    t.after(async () => { child.kill(); await exited; await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) })
    let output = '', base = '', ready = false
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    for (let i = 0; i < 100 && (!base || !ready); i++) {
        await delay(50)
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        assert.equal(child.exitCode, null, output)
        ready = await readFile(join(cwd, 'probe-ready')).then(() => true, () => false)
    }
    assert.ok(base && ready, output)
    for (const group of groups) {
        const params = new URLSearchParams({ uri: `/${group}/`, fileMask: group === 'filtered' ? '*.absent' : '*.txt' })
        if (group === 'limited') params.set('limit', '1')
        const response = await fetch(base + '/~/api/get_file_list?' + params)
        assert.equal(response.status, 200, output)
        const { list } = await response.json() as { list: { n: string, comment?: string, icon?: string }[] }
        await delay(100) // outstanding reads may finish after a limited response
        const metrics = JSON.parse(await readFile(join(cwd, 'metrics.json'), 'utf8'))[group] as {
            started: string[], max: number, active: number, hooks: string[], maxHooks: number,
        }
        const excluded = group === 'sync' ? ['file03.txt', 'file04.txt', 'file07.txt', 'file08.txt'] : []
        assert.deepEqual(metrics.hooks.filter(name => !excluded.includes(name)), list.map(x => x.n))
        if (group === 'sync') {
            assert.ok(list.every(entry => entry.comment === 'legacy' && entry.icon === 'event'))
            assert.ok(output.includes('Plugin probe is causing problems on onDirEntry: Error: sync failure'), output)
            assert.ok(output.includes('Plugin probe is causing problems on onDirEntry: Error: async failure'), output)
        }
        assert.ok(metrics.maxHooks <= 1)
        assert.equal(metrics.active, 0)
        assert.equal(list.length, group === 'full' ? 20 : group === 'sync' ? 16 : group === 'limited' ? 1 : 0)
        assert.ok(!metrics.started.includes('file-hidden.txt') && !metrics.started.includes('file-skip.bin'))
        if (process.platform !== 'win32') {
            if (group === 'full') {
                assert.ok(metrics.max > 1 && metrics.max <= 4, JSON.stringify(metrics))
                assert.deepEqual(metrics.started, list.map(x => x.n))
            }
            else assert.equal(metrics.started.length, group === 'sync' ? 20 : group === 'limited' ? 4 : 0)
        }
        else assert.equal(metrics.started.length, 0) // native Windows enumeration already supplies stats
    }
})
