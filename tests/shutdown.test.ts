import test, { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { promisify } from 'node:util'
import { KvStorage } from '@rejetto/kvstorage'

const exec = promisify(execFile)

// use real child processes because exit listeners and forced termination cannot be verified in the test runner
async function runShutdown(t: TestContext, body: string, exitCode=0) {
    const folder = await mkdtemp(join(tmpdir(), 'hfs-shutdown-'))
    t.after(() => rm(folder, { recursive: true, force: true }))
    const result = await exec(process.execPath, ['--import', 'tsx', '-e', String.raw`
        const assert = require('node:assert/strict')
        const { appendFileSync } = require('node:fs')
        const first = require('./src/first.ts')
        const { onProcessExit, onFirstEvent, quit } = first
        const record = value => appendFileSync(process.env.TRACE, value + '\n')
        const wait = require('node:timers/promises').setTimeout
        ${body}
    `], {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, TRACE: join(folder, 'trace'), STORAGE: join(folder, 'data.kv') },
        timeout: 5000,
        killSignal: 'SIGKILL',
    }).then(result => ({ ...result, code: 0 }), error => {
        if (typeof error.code !== 'number') throw error
        return error
    })
    assert.equal(result.code, exitCode, result.stderr)
    return { folder, trace: (await readFile(join(folder, 'trace'), 'utf8')).trim().split('\n'), stderr: result.stderr }
}

for (const trigger of ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP', 'quit', 'beforeExit']) {
    test(`shutdown: ${trigger} waits for ordered groups and survives cleanup errors`, {
        // Windows process.kill terminates the target instead of delivering POSIX signals
        skip: process.platform === 'win32' && trigger.startsWith('SIG'),
    }, async t => {
        const { trace, stderr } = await runShutdown(t, `
            onProcessExit(() => record('last'), 20)
            onProcessExit(() => { record('removed') })()
            onProcessExit(async () => {
                assert.equal(first.quitting, true)
                record('async-start')
                await wait(20)
                record('async-end')
            }, 5)
            onProcessExit(() => { record('throw'); throw Error('sync cleanup failure') }, 5)
            onProcessExit(async () => { record('reject'); throw Error('async cleanup failure') }, 5)
            onProcessExit(() => record('peer'), 5)
            onProcessExit(signal => record('next:' + signal))
            ${trigger === 'quit' ? 'quit(7)' : trigger === 'beforeExit' ? '' : `process.kill(process.pid, '${trigger}'); setTimeout(() => {}, 1000)`}
        `, trigger === 'quit' ? 7 : 0)
        assert.deepEqual(trace, ['async-start', 'throw', 'reject', 'peer', 'async-end',
            'next:' + (trigger === 'quit' ? 'SIGINT' : trigger), 'last'])
        assert.match(stderr, /sync cleanup failure/)
    })
}

test('shutdown: exit invokes every synchronous group and preserves the exit code', async t => {
    const { trace } = await runShutdown(t, `
        onProcessExit(() => record('last'), 20)
        onProcessExit(() => { record('first'); throw Error('expected cleanup failure') }, 5)
        onProcessExit(() => record('middle'))
        process.exit(7)
    `, 7)
    assert.deepEqual(trace, ['first', 'middle', 'last'])
})

test('shutdown: onFirstEvent runs synchronously once and removes sibling listeners', async t => {
    const { trace } = await runShutdown(t, `
        const emitter = new (require('node:events').EventEmitter)()
        onFirstEvent(emitter, ['a', 'b'], (event, value) => {
            record(event + ':' + value)
            emitter.emit('b', 2)
        })
        emitter.emit('a', 1)
        record('returned')
        emitter.emit('a', 3)
        assert.equal(emitter.listenerCount('a'), 0)
        assert.equal(emitter.listenerCount('b'), 0)
    `)
    assert.deepEqual(trace, ['a:1', 'returned'])
})

test('shutdown: storage close flushes a pending write before the next group', async t => {
    const { trace, folder } = await runShutdown(t, `
        const { KvStorage } = require('@rejetto/kvstorage')
        ;(async () => {
            const storage = new KvStorage()
            await storage.open(process.env.STORAGE)
            void storage.put('pending', 'saved on shutdown', { delay: 60000, maxDelay: 60000, maxDelayCreate: 60000 })
            assert.equal(require('node:fs').readFileSync(process.env.STORAGE, 'utf8').includes('saved on shutdown'), false)
            onProcessExit(() => storage.close())
            onProcessExit(() => record('closed:' + storage.isOpen()), 20)
            quit()
        })().catch(error => { console.error(error); process.exit(1) })
    `)
    assert.deepEqual(trace, ['closed:false'])
    const storage = new KvStorage()
    await storage.open(join(folder, 'data.kv'))
    try {
        assert.equal(storage.getSync('pending'), 'saved on shutdown')
    }
    finally {
        await storage.close()
    }
})
