import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { UPLOAD_TEMP_PREFIX } from '../src/cross-const'

for (const retention of [0, 60]) {
    test(`multipart failures release uploads with ${retention}s cleanup`, { timeout: 30000 }, async t => {
        const cwd = await mkdtemp(join(tmpdir(), 'hfs-multipart-'))
        const share = join(cwd, 'share')
        const authorization = 'Basic ' + Buffer.from('owner:secret').toString('base64')
        const boundary = 'hfs-multipart-test'
        const headers = { authorization, 'content-type': `multipart/form-data; boundary=${boundary}` }
        await mkdir(share)
        await mkdir(join(share, 'blocked'))
        await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
            port: 0, https_port: -1, listen_interface: '127.0.0.1', localhost_admin: false,
            open_browser_at_start: false, enable_plugins: [], log: '', error_log: '', min_available_mb: 0,
            delete_unfinished_uploads_after: retention, accounts: { owner: { password: 'secret' } },
            vfs: { source: share, can_upload: ['owner'], can_delete: false,
                children: [{ source: join(share, 'blocked'), can_upload: false }] },
        }))
        const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--cwd', cwd, '--no-central'], {
            cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
        })
        const stopped = once(child, 'exit')
        t.after(async () => {
            child.kill('SIGKILL')
            await stopped
            await rm(cwd, { recursive: true, force: true })
        })
        let output = '', base = ''
        child.stdout.on('data', chunk => output += chunk)
        child.stderr.on('data', chunk => output += chunk)
        await until(() => {
            base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
            return Boolean(base)
        })

        for (const query of ['', '?get=basic']) {
            await t.test(`truncated file returns 400 and can be retried ${query}`, async () => {
                const name = query ? 'basic.txt' : 'api.txt'
                await writeFile(join(share, name), 'original')
                const response = await post(part(name, 'incomplete'), query)
                assert.equal(response.status, 400)
                await response.text()
                assert.equal(await readFile(join(share, name), 'utf8'), 'original')
                assert.deepEqual((await readdir(share)).filter(x => x.includes(name.slice(0, -4))), [name])
                const retry = await post(part(name, 'retry') + `--${boundary}--\r\n`, query)
                assert.equal(retry.status, 200)
                await retry.text()
                assert.equal(await readFile(join(share, name.slice(0, -4) + ' (1).txt'), 'utf8'), 'retry')
            })
        }

        await t.test('completed files survive a later truncated part', async () => {
            const response = await post(part('complete.txt', 'complete') + part('broken.txt', 'incomplete'))
            assert.equal(response.status, 400)
            const result = await response.json()
            assert.equal(result.uris.filter(Boolean).length, 1)
            assert.equal(await readFile(join(share, 'complete.txt'), 'utf8'), 'complete')
            await assert.rejects(stat(join(share, 'broken.txt')), { code: 'ENOENT' })
            await assert.rejects(stat(join(share, UPLOAD_TEMP_PREFIX + 'broken.txt')), { code: 'ENOENT' })
        })

        await t.test('rejected truncated files are drained even after the stream has closed', async () => {
            for (const [name, uri] of [['denied.txt', '/blocked/'], ['../invalid.txt', '/']] as const) {
                const response = await post(part(name, 'incomplete'), '', uri)
                assert.ok(response.status >= 400)
                await response.text()
            }
        })

        await t.test('cancelling releases the filename and preserves retry ownership', async () => {
            const name = 'cancelled.txt'
            const req = request(base + '/?get=basic', {
                method: 'POST', headers: { ...headers, 'content-length': 100000 },
            })
            req.on('error', () => {}) // client cancellation deliberately resets the connection
            t.after(() => req.destroy())
            req.write(part(name, 'partial'))
            await until(() => stat(join(share, UPLOAD_TEMP_PREFIX + name)).then(s => s.size > 0, () => false))
            req.destroy()
            let status = 409
            await until(async () => {
                const response = await post(part(name, 'retry') + `--${boundary}--\r\n`)
                status = response.status
                await response.text()
                return status !== 409
            })
            assert.equal(status, 200)
            assert.equal(await readFile(join(share, name), 'utf8'), 'retry')
        })
        assert.doesNotMatch(output, /Uncaught:|Unhandled/)

        function part(name: string, content: string) {
            return `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="${name}"\r\n\r\n${content}\r\n`
        }

        function post(body: string, query='', uri='/') {
            return fetch(base + uri + query, { method: 'POST', headers, body, signal: AbortSignal.timeout(2000) })
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
