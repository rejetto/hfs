import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, cp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

test('hash-search React fields, local SHA-512, partial results, URL restoration and ZIP', async ({ page }, testInfo) => {
    const plugin = resolve('../hfs-plugin/hfs-hash-search/dist')
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'hfs-hash-search-ui-')))
    await mkdir(join(cwd, 'shared/sub'), { recursive: true })
    await writeFile(join(cwd, 'shared/alpha.txt'), 'alpha')
    await writeFile(join(cwd, 'shared/sub/beta.txt'), 'beta')
    await cp(plugin, join(cwd, 'plugins/renamed-search'), { recursive: true })
    await writeFile(join(cwd, 'preload.cjs'), `
const fs = require('node:fs');
const original = fs.createReadStream;
fs.createReadStream = function(path, options) {
    const stream = original.call(this, path, options);
    if (!String(path).startsWith(${JSON.stringify(join(cwd, 'shared'))})) return stream;
    const iterator = stream[Symbol.asyncIterator];
    stream[Symbol.asyncIterator] = async function*() {
        while (!fs.existsSync(${JSON.stringify(join(cwd, 'release'))}))
            await new Promise(resolve => setTimeout(resolve, 10));
        yield* iterator.call(this);
    };
    return stream;
};
`)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '', directory_cache: 0, enable_plugins: ['renamed-search'],
        plugins_config: { 'renamed-search': { algorithms: ['md5', 'sha256', 'sha512'] } },
        vfs: { children: [{ name: 'files', source: join(cwd, 'shared') }] },
    }))
    const child = spawn(process.execPath, ['--require', join(cwd, 'preload.cjs'), resolve('dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
        for (let i = 0; i < 150; i++) {
            base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
            expect(child.exitCode, output).toBeNull()
            if (base) {
                const response = await fetch(base + '/~/api/get_file_list?uri=/files/').then(r => r.json())
                if (response.searchFields?.length) break
            }
            await delay(40)
        }
        expect(base, output).not.toBe('')
        await page.goto(base + '/files/')
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toBeVisible()
        let releaseStatus: () => void
        let heldStatus = false
        const statusGate = new Promise<void>(resolve => { releaseStatus = resolve })
        await page.route('**/~/api/_renamed-search:get_status', async route => {
            const response = await route.fetch()
            if (!heldStatus) {
                heldStatus = true
                await statusGate
            }
            await route.fulfill({ response })
        })
        await page.locator('#search-button').click()
        await page.getByRole('button', { name: 'More filters' }).click()
        const hash = page.getByRole('textbox', { name: 'Hash or prefix' })
        const algorithm = page.getByRole('combobox', { name: 'Hash algorithm' })
        await expect(hash).toBeVisible()
        await expect.poll(() => heldStatus).toBe(true)
        await fetch(base + '/~/api/get_file_list?' + new URLSearchParams({
            uri: '/files/', pluginSearch: JSON.stringify({ 'renamed-search': { algorithm: 'md5', prefix: 'a' } }),
        }))
        await expect(page.getByText('Updating search data…', { exact: false })).toBeVisible()
        const staleResponse = page.waitForResponse(response => response.url().endsWith('/_renamed-search:get_status'))
        releaseStatus!()
        await (await staleResponse).finished()
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await expect(page.getByText('Updating search data…', { exact: false })).toBeVisible()
        await hash.fill('a'.repeat(32))
        await expect(algorithm).toHaveValue('md5')
        await hash.fill('a'.repeat(64))
        await expect(algorithm).toHaveValue('sha256')
        await hash.fill('abcde')
        await expect(algorithm).toHaveValue('')
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(hash).toBeVisible()
        await algorithm.selectOption('sha512')
        await hash.fill('a'.repeat(32))
        await expect(algorithm).toHaveValue('sha512')

        const digest = createHash('sha512').update('alpha').digest('hex')
        // delay a real Blob read so cancellation is tested independently of machine speed
        function holdBlobRead() {
            const original = Blob.prototype.arrayBuffer
            let release: () => void
            const gate = new Promise<void>(resolve => { release = resolve })
            const probe = (window as any).hashRead = { started: false, release() { Blob.prototype.arrayBuffer = original; release() } }
            Blob.prototype.arrayBuffer = async function () {
                const result = await original.call(this)
                if (this.size === 1024 * 1024 && !probe.started) {
                    probe.started = true
                    await gate
                }
                return result
            }
        }
        await page.evaluate(holdBlobRead)
        await page.locator('#search-dialog input[type=file]').setInputFiles({ name: 'overridden.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * 1024 * 1024) })
        await page.waitForFunction(() => (window as any).hashRead.started)
        await algorithm.selectOption('md5')
        await hash.fill('abcde')
        await page.evaluate(() => (window as any).hashRead.release())
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeHidden()
        await expect(algorithm).toHaveValue('md5')
        await expect(hash).toHaveValue('abcde')

        await page.evaluate(holdBlobRead)
        await page.locator('#search-dialog input[type=file]').setInputFiles({ name: 'cancelled.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(8 * 1024 * 1024) })
        await page.waitForFunction(() => (window as any).hashRead.started)
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.locator('#search-dialog input[type=file]').setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha') })
        await expect(hash).toHaveValue(digest)
        await page.evaluate(() => (window as any).hashRead.release())
        await expect(algorithm).toHaveValue('sha512')
        await testInfo.attach('hash-search-dialog', { body: await page.screenshot({ path: testInfo.outputPath('hash-search-dialog.png') }), contentType: 'image/png' })
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(page).toHaveURL(/pluginSearch=/)
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        const first = await page.evaluate(() => (window as any).HFS.state.props.searchIncomplete)
        expect(first).toEqual(['renamed-search'])
        await expect(page.getByText('Partial results: some search data is not ready.', { exact: false })).toBeVisible()
        await page.locator('#search-button').click()
        await expect(page.getByText('Updating search data…', { exact: false })).toBeVisible()
        await writeFile(join(cwd, 'release'), '')
        await expect(page.getByText('No updates in progress.', { exact: false })).toBeVisible()
        await page.locator('#search-dialog').getByRole('button', { name: 'Repeat search', exact: true }).click()
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.props?.searchIncomplete)).toEqual([])
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'beta.txt', exact: true })).toHaveCount(0)
        await page.reload()
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toBeVisible()
        await page.locator('#search-button').click()
        await expect(hash).toHaveValue(digest)
        await expect(algorithm).toHaveValue('sha512')
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        const zip = await page.locator('#zip-button').getAttribute('href')
        expect(zip).toContain('pluginSearch=')
        const response = await page.request.get(new URL(zip!, base + '/files/').href)
        expect(response.ok()).toBe(true)
        const unzipper = await import('unzipper')
        const archive = await unzipper.Open.buffer(await response.body())
        expect(archive.files.map(file => file.path)).toEqual(['alpha.txt'])
        await page.goto(base + '/~/admin/#/plugins/installed')
        await page.getByRole('button', { name: 'Options', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Clean removed files', exact: true })).toBeVisible()
        await expect(page.getByRole('combobox', { name: 'Filesystem root to clean' })).toBeVisible()
        await page.getByRole('button', { name: 'Clean removed files', exact: true }).click()
        await page.getByRole('button', { name: 'Go', exact: true }).click()
        await expect(page.getByText('Removed 0 records; retained 2.', { exact: true })).toBeVisible()
        expect(errors).toEqual([])
    }
    finally {
        await writeFile(join(cwd, 'release'), '')
        child.kill()
        await exited
        await rm(cwd, { recursive: true, force: true, maxRetries: 5 })
    }
})
