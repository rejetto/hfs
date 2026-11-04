import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const exec = promisify(execFile)
const root = resolve(__dirname, '..')
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts

test('local CI checks the requested abbreviated commit on first launch and runs every stage', async t => {
    const fixture = await setup(t)
    const first = await fixture.git('rev-parse', 'HEAD')
    await writeFile(join(fixture.cwd, 'next'), 'next commit')
    await fixture.git('add', 'next')
    await fixture.git('commit', '-m', 'next')
    await fixture.run(first.slice(0, 8))
    const records = await fixture.records()
    assert.deepEqual(records.map(x => x.stage), ['build-all', 'test-with-server', 'test-ui'])
    assert.ok(records.every(x => x.commit === first && x.port === 18081 && x.baseUrl === 'http://127.0.0.1:18081'))
    assert.equal(records[2].noSnapshots, '1')
    assert.equal(records[2].ci, '1')
    assert.equal(records[2].secondary, '18082')
    assert.equal(records[2].admin, '13112')
})

test('local CI isolates the branch tip too and honors its validated-commit cache', async t => {
    const fixture = await setup(t)
    const tip = await fixture.git('rev-parse', 'HEAD')
    await fixture.git('branch', 'aaa-same-tip')
    await fixture.run(tip.slice(0, 8))
    assert.equal((await fixture.records())[2].noSnapshots, '')
    assert.equal((await fixture.records())[2].snapshotBranch, 'main')
    assert.equal((await fixture.records())[2].port, 18081)
    await fixture.run(tip)
    assert.equal((await fixture.records()).length, 3)
    await fixture.run(tip, '--force')
    assert.equal((await fixture.records()).length, 6)
})

test('local CI checks multiple cached commits and recognizes abbreviated history', async t => {
    const fixture = await setup(t)
    const first = await fixture.git('rev-parse', 'HEAD')
    await fixture.git('commit', '--allow-empty', '-m', 'next')
    const tip = await fixture.git('rev-parse', 'HEAD')
    await mkdir(join(fixture.cwd, '.ci'))
    const historyPath = join(fixture.cwd, '.ci/tested.json')
    await writeFile(historyPath, JSON.stringify([{ commit: first }]))
    const fresh = await fixture.run(tip)
    assert.doesNotMatch(fresh.stderr, /jq: error/)
    assert.equal((await fixture.records()).length, 3)
    const history = JSON.parse(await readFile(historyPath, 'utf8'))
    history[1].commit = tip.slice(0, 8)
    await writeFile(historyPath, JSON.stringify(history))
    const cached = await fixture.run(tip)
    assert.doesNotMatch(cached.stderr, /jq: error/)
    assert.match(cached.stdout, /already validated/)
    assert.equal((await fixture.records()).length, 3)
})

test('local CI stops on backend failure instead of validating the commit', async t => {
    const fixture = await setup(t)
    await assert.rejects(fixture.run('HEAD', { LOCAL_CI_FAIL: 'test-with-server' }), error => {
        assert.equal((error as { code: number }).code, 1)
        return true
    })
    assert.deepEqual((await fixture.records()).map(x => x.stage), ['build-all', 'test-with-server'])
    assert.deepEqual(JSON.parse(await readFile(join(fixture.cwd, '.ci/tested.json'), 'utf8').catch(() => '[]')), [])
})

test('local CI watch drops an interrupted queue entry that is already validated', async t => {
    const fixture = await setup(t)
    const commit = await fixture.git('rev-parse', 'HEAD')
    await mkdir(join(fixture.cwd, '.ci'))
    await writeFile(join(fixture.cwd, '.ci/tested.json'), JSON.stringify([{ commit }]))
    await writeFile(join(fixture.cwd, '.ci/queue.json'), JSON.stringify([{ commit, branch: 'main' }]))
    await writeFile(join(fixture.cwd, '.ci/in_progress.json'), JSON.stringify({ commit, branch: 'main' }))
    // stop at the idle wait so watch mode can be checked without waiting for another iteration
    await writeFile(join(fixture.cwd, 'bin/sleep'), '#!/bin/sh\nif [ "$1" = 30 ]; then kill -TERM "$PPID"; else /bin/sleep "$@"; fi\n', { mode: 0o755 })
    await assert.rejects(fixture.run('watch'), error => {
        assert.equal((error as { code: number }).code, 130)
        assert.match((error as { stdout: string }).stdout, /Skipping validated queued commit/)
        return true
    })
    assert.deepEqual(JSON.parse(await readFile(join(fixture.cwd, '.ci/queue.json'), 'utf8')), [])
    assert.equal(await readFile(join(fixture.cwd, 'stages.jsonl'), 'utf8').catch(() => ''), '')
})

test('the port check uses tests/config.yaml unless a port is explicitly supplied', async t => {
    const fixture = await setup(t)
    const server = createServer((_, response) => response.end('ready'))
    await new Promise<void>(resolve => server.listen(0, resolve))
    t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await writeFile(join(fixture.cwd, 'tests/config.yaml'), `port: ${address.port}\n`)
    await assert.rejects(exec('npm', ['run', 'port-is-free'], {
        cwd: fixture.cwd, env: { ...process.env, NODE_PATH: join(root, 'node_modules') },
    }), error => {
        assert.equal((error as { code: number }).code, 1)
        return true
    })
    await writeFile(join(fixture.cwd, 'tests/config.yaml'), 'invalid: [')
    await assert.rejects(exec('npm', ['run', 'port-is-free', '--', String(address.port)], {
        cwd: fixture.cwd,
    }), error => {
        assert.match((error as { stdout: string }).stdout, /BUSY/)
        return true
    })
})

test('isolated Playwright config uses separate fixture ports and never reuses servers', async () => {
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', '-e', `
        const config = require('./playwright.config.ts').default
        console.log(JSON.stringify({ servers: config.webServer, ignoreSnapshots: config.ignoreSnapshots }))
    `], { cwd: root, env: { ...process.env, CI: '1', NO_SS: '1', HFS_TEST_SECONDARY_PORT: '18082', HFS_TEST_ADMIN_PORT: '13112' } })
    const config = JSON.parse(stdout)
    assert.ok(config.servers.every((server: { reuseExistingServer: boolean }) => server.reuseExistingServer === false))
    assert.ok(config.servers[1].command.includes('--port 18082'))
    assert.ok(config.servers[2].command.includes('--port 13112'))
    assert.equal(config.servers[2].url, 'http://127.0.0.1:13112/')
    assert.equal(config.ignoreSnapshots, true)
})

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'hfs-local-ci-')))
    t.after(() => rm(cwd, { recursive: true, force: true }))
    await mkdir(join(cwd, 'scripts'))
    await mkdir(join(cwd, 'tests'))
    await mkdir(join(cwd, 'bin'))
    await copyFile(join(root, 'scripts/local-ci.sh'), join(cwd, 'scripts/local-ci.sh'))
    await writeFile(join(cwd, '.gitignore'), '.ci/\n')
    await writeFile(join(cwd, 'tests/config.yaml'), 'port: 8081\nbase_url: http://127.0.0.1:8081\n')
    await writeFile(join(cwd, 'bin/osascript'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    await writeFile(join(cwd, 'stage.cjs'), `
        const fs = require('node:fs'), cp = require('node:child_process')
        const stage = process.env.npm_lifecycle_event
        fs.appendFileSync(process.env.LOCAL_CI_LOG, JSON.stringify({ stage,
            commit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            port: Number(/port: (\\d+)/.exec(fs.readFileSync('tests/config.yaml', 'utf8'))[1]),
            baseUrl: /base_url: (.+)/.exec(fs.readFileSync('tests/config.yaml', 'utf8'))[1],
            ci: process.env.CI, noSnapshots: process.env.NO_SS,
            secondary: process.env.HFS_TEST_SECONDARY_PORT, admin: process.env.HFS_TEST_ADMIN_PORT,
            snapshotBranch: process.env.PLAYWRIGHT_SNAPSHOT_BRANCH,
        }) + '\\n')
        if (stage === process.env.LOCAL_CI_FAIL) process.exit(17)
    `)
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ private: true, scripts: {
        'build-all': 'node stage.cjs', 'test-with-server': 'node stage.cjs', 'test-ui': 'node stage.cjs',
        'port-is-free': scripts['port-is-free'],
    } }))
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'Local CI test')
    await git('config', 'user.email', 'test@example.invalid')
    await git('add', '.')
    await git('commit', '-m', 'fixture')
    return { cwd, git, run, records }

    async function git(...args: string[]) {
        return (await exec('git', args, { cwd })).stdout.trim()
    }
    async function run(commit: string, forceOrEnv: string | Record<string, string> = {}) {
        return exec('/bin/bash', ['scripts/local-ci.sh', commit, ...(typeof forceOrEnv === 'string' ? [forceOrEnv] : [])], {
            cwd, timeout: 20000, env: { ...process.env, PATH: join(cwd, 'bin') + ':' + process.env.PATH,
                LOCAL_CI_LOG: join(cwd, 'stages.jsonl'), ...(typeof forceOrEnv === 'object' ? forceOrEnv : {}) },
        })
    }
    async function records(): Promise<{ stage: string, commit: string, port: number, baseUrl: string, noSnapshots: string, ci: string, secondary: string, admin: string, snapshotBranch: string, pluginsRoot: string }[]> {
        return (await readFile(join(cwd, 'stages.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    }
}
