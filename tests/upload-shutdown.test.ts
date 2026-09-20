import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { UPLOAD_TEMP_PREFIX } from '../src/cross-const'

for (const retention of [0, 60]) {
    test(`shutdown preserves active uploads with ${retention}s cleanup`, {
        timeout: 15000,
        skip: process.platform === 'win32', // Windows SIGTERM terminates without running shutdown handlers
    }, async t => {
        const cwd = await mkdtemp(join(tmpdir(), 'hfs-upload-shutdown-'))
        const uploads = join(cwd, 'uploads')
        await mkdir(uploads)
        await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
            port: 0, https_port: -1, listen_interface: '127.0.0.1',
            open_browser_at_start: false, enable_plugins: [], log: '', error_log: '',
            min_available_mb: 0, delete_unfinished_uploads_after: retention,
            vfs: { source: uploads, can_upload: true },
        }))
        // hold the server-stop group open so aborted upload handlers finish before cleanup, regardless of disk timing
        const child = spawn(process.execPath, ['--import', 'tsx', '-e', `
            require('./src/first.ts').onProcessExit(() => new Promise(r => setTimeout(r, 500)), 5)
            require('./src/index.ts')
        `, 'hfs', '--cwd', cwd, '--no-central'], { cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] })
        const stopped = once(child, 'exit')
        t.after(async () => {
            child.kill('SIGKILL')
            await stopped
            await rm(cwd, { recursive: true, force: true })
        })
        let output = ''
        child.stdout.on('data', chunk => output += chunk)
        child.stderr.on('data', chunk => output += chunk)
        await until(() => /Serving on http:\/\/127\.0\.0\.1:\d+/.test(output))
        const url = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]
        const active = await startUpload('active.txt')
        const aborted = await startUpload('aborted.txt')
        aborted.destroy()
        // allow the ordinary abort to enter cleanup before initiating shutdown
        await delay(200)
        child.kill('SIGTERM')
        const [code] = await stopped
        active.destroy()
        assert.equal(code, 0, output)
        assert.equal(await readFile(join(uploads, UPLOAD_TEMP_PREFIX + 'active.txt'), 'utf8'), 'payload')
        await assert.rejects(stat(join(uploads, UPLOAD_TEMP_PREFIX + 'aborted.txt')), { code: 'ENOENT' })

        async function startUpload(name: string) {
            const req = request(url + '/' + name, { method: 'PUT', headers: { 'content-length': 10000 } })
            req.on('error', () => {}) // shutdown and client abort deliberately reset these requests
            t.after(() => req.destroy())
            req.write('payload')
            await until(() => stat(join(uploads, UPLOAD_TEMP_PREFIX + name)).then(s => s.size === 7, () => false))
            return req
        }

        async function until(check: () => boolean | Promise<boolean>) {
            for (let i = 0; i < 100; i++) {
                if (await check()) return
                assert.equal(child.exitCode, null, output)
                await delay(50)
            }
            assert.fail(output)
        }
    })
}
