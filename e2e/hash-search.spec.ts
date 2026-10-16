import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, cp, rm, realpath, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

test('hash-search React fields, local SHA-512, partial results, URL restoration and ZIP', async ({ page }, testInfo) => {
    test.setTimeout(60000)
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
    let releaseStatus: (() => void) | undefined
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
        await expect(page.getByText('Enable Directory cache', { exact: false })).toBeHidden()
        if (testInfo.project.name === 'chromium') {
            const viewport = page.viewportSize()!
            for (const width of [375, 671, 673, 1920]) {
                await page.setViewportSize({ width, height: 900 })
                const bounds = await page.locator('.hfs-hash-search-controls').evaluate(controls => {
                    const algorithm = controls.querySelector('.hfs-hash-search-algorithm')!.getBoundingClientRect()
                    const hash = controls.querySelector('.hfs-hash-search-prefix')!.getBoundingClientRect()
                    const button = controls.querySelector('button')!.getBoundingClientRect()
                    return { algorithmWidth: algorithm.width, hashTop: hash.top, firstRowBottom: Math.max(algorithm.bottom, button.bottom),
                        overflow: controls.scrollWidth > controls.clientWidth,
                        buttonHeight: button.height, buttonLine: parseFloat(getComputedStyle(controls.querySelector('button')!).fontSize) }
                })
                expect(bounds.hashTop).toBeGreaterThan(bounds.firstRowBottom)
                expect(bounds.overflow).toBe(false)
                expect(bounds.algorithmWidth).toBeGreaterThan(100)
                expect(bounds.buttonHeight).toBeLessThan(bounds.buttonLine * 2)
            }
            await page.setViewportSize(viewport)
        }
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

        await hash.evaluate(input => {
            const events: string[] = []
            ;(window as any).hashAnimations = events
            input.addEventListener('animationstart', event => events.push((event as AnimationEvent).animationName))
        })
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
        expect(await page.evaluate(() => (window as any).hashAnimations)).toEqual([])
        await page.locator('#search-dialog input[type=file]').setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha') })
        await expect(hash).toHaveValue(digest)
        await expect.poll(() => page.evaluate(() => (window as any).hashAnimations)).toEqual(['attention'])
        await expect(hash).toHaveCSS('animation-iteration-count', '1')
        await page.evaluate(() => (window as any).hashRead.release())
        await expect(algorithm).toHaveValue('sha512')
        await testInfo.attach('hash-search-dialog', { body: await page.screenshot({ path: testInfo.outputPath('hash-search-dialog.png') }), contentType: 'image/png' })
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(page).toHaveURL(/pluginSearch=/)
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        const first = await page.evaluate(() => (window as any).HFS.state.props.searchIncomplete)
        expect(first).toEqual(['renamed-search'])
        await expect(page.getByText('Partial results: some search data is not ready.', { exact: false })).toBeVisible()
        const partial = page.locator('.search-partial')
        await expect(partial).toHaveCSS('align-items', 'center')
        expect(await partial.evaluate(element => parseFloat(getComputedStyle(element).gap))).toBeGreaterThan(0)
        await testInfo.attach('hash-partial-results', { body: await page.screenshot({ path: testInfo.outputPath('hash-partial-results.png') }), contentType: 'image/png' })

        await page.locator('#search-button').click()
        await expect(page.getByText('Updating search data…', { exact: false })).toBeVisible()
        await writeFile(join(cwd, 'release'), '')
        await expect(page.getByText('Updating search data…', { exact: false })).toBeHidden()
        await expect(page.getByText('No updates in progress.', { exact: false })).toBeHidden()
        await page.locator('#search-dialog').getByRole('button', { name: 'Repeat search', exact: true }).click()
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.props?.searchIncomplete)).toEqual([])
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'beta.txt', exact: true })).toHaveCount(0)
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
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
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        await page.goto(base + '/~/admin/#/plugins/installed')
        await page.getByRole('button', { name: 'Options', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Clean removed files', exact: true })).toBeVisible()
        await expect(page.getByRole('combobox', { name: 'Filesystem root to clean' })).toBeVisible()
        await page.getByRole('button', { name: 'Clean removed files', exact: true }).click()
        await page.getByRole('button', { name: 'Go', exact: true }).click()
        await expect(page.getByText('Removed 0 records; retained 2.', { exact: true })).toBeVisible()
        for (const enabled of [['sha512'], ['md5', 'sha512']]) {
            const configured = await page.request.post(base + '/~/api/set_plugin', {
                headers: { 'x-hfs-anti-csrf': '1' },
                data: { id: 'renamed-search', config: { algorithms: enabled } },
            })
            expect(configured.ok()).toBe(true)
            await page.goto(base + '/files/')
            await page.locator('#search-button').click()
            await page.getByRole('button', { name: 'More filters' }).click()
            expect(await algorithm.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
                .toEqual(enabled.length === 1 ? enabled : ['', ...enabled])
            await expect(algorithm).toHaveValue(enabled.length === 1 ? 'sha512' : '')
            await hash.fill('abcde')
            await expect(algorithm).toHaveValue(enabled.length === 1 ? 'sha512' : '')
            await hash.fill('a'.repeat(64))
            await expect(algorithm).toHaveValue(enabled.length === 1 ? 'sha512' : '')
            await hash.fill('a'.repeat(32))
            await expect(algorithm).toHaveValue(enabled.length === 1 ? 'sha512' : 'md5')
            await page.getByRole('button', { name: 'Continue', exact: true }).click()
            await expect.poll(() => page.evaluate(() => JSON.parse(new URLSearchParams(location.search).get('pluginSearch') || '{}')['renamed-search']?.algorithm))
                .toBe(enabled.length === 1 ? 'sha512' : 'md5')
            await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        }
        const single = await page.request.post(base + '/~/api/set_plugin', {
            headers: { 'x-hfs-anti-csrf': '1' }, data: { id: 'renamed-search', config: { algorithms: ['sha512'] } },
        })
        expect(single.ok()).toBe(true)
        await page.goto(base + '/files/?' + new URLSearchParams({ pluginSearch: JSON.stringify({ 'renamed-search': { algorithm: 'md5', prefix: 'abcde' } }) }))
        await page.locator('#search-button').click()
        await expect(algorithm).toHaveValue('sha512')
        await expect(hash).toHaveValue('abcde')
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect.poll(() => page.evaluate(() => JSON.parse(new URLSearchParams(location.search).get('pluginSearch') || '{}')['renamed-search']?.algorithm)).toBe('sha512')
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        await page.unroute('**/~/api/_renamed-search:get_status')
        let rejectStatus = true
        await page.route('**/~/api/_renamed-search:get_status', async route => {
            if (rejectStatus) {
                await route.fulfill({ status: 400, body: 'invalid api' })
            }
            else await route.continue()
        })
        await page.goto(base + '/files/')
        await page.locator('#search-button').click()
        await page.getByRole('button', { name: 'More filters' }).click()
        await expect(page.getByRole('alert').filter({ hasText: 'invalid api' })).toBeVisible()
        rejectStatus = false
        const configured = await page.request.post(base + '/~/api/set_plugin', {
            headers: { 'x-hfs-anti-csrf': '1' },
            data: { id: 'renamed-search', config: { algorithms: ['md5', 'sha512'] } },
        })
        expect(configured.ok()).toBe(true)
        await expect(page.getByRole('alert').filter({ hasText: 'invalid api' })).toBeHidden()
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.locator('#search-dialog input[type=file]').setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha') })
        await expect(hash).toHaveValue(digest)
        await expect(hash).toHaveCSS('animation-name', 'none')

        for (const language of ['it', 'fr']) {
            await page.context().setExtraHTTPHeaders({ 'Accept-Language': language })
            await page.goto(base + '/files/?' + new URLSearchParams({ lang: language,
                pluginSearch: JSON.stringify({ 'renamed-search': { algorithm: 'sha512', prefix: 'abcde' } }),
            }))
            await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
            await page.locator('#search-button').click()
            const italian = language === 'it'
            await expect(page.getByRole('combobox', { name: italian ? "Algoritmo dell’hash" : 'Hash algorithm' })).toBeVisible()
            await expect(page.getByRole('textbox', { name: italian ? 'Hash o prefisso' : 'Hash or prefix' })).toHaveValue('abcde')
            await expect(page.getByRole('button', { name: italian ? 'Hash file locale…' : 'Hash local file…' })).toBeVisible()
            await expect(page.locator('.hfs-hash-search > [role=status]')).toHaveCount(0)
            if (italian) {
                await testInfo.attach('hash-search-italian', { body: await page.screenshot({ path: testInfo.outputPath('hash-search-italian.png') }), contentType: 'image/png' })
                const invalid = await page.request.get(base + '/~/api/get_file_list?' + new URLSearchParams({ uri: '/files/',
                    pluginSearch: JSON.stringify({ 'renamed-search': { algorithm: 'md5', prefix: 'invalid' } }),
                }))
                expect(invalid.status()).toBe(400)
                expect(await invalid.text()).toContain('Scegli un algoritmo e inserisci un hash esadecimale o un prefisso')
            }
        }
        const adminLanguage = await page.request.post(base + '/~/api/set_config', {
            headers: { 'x-hfs-anti-csrf': '1' }, data: { values: { admin_lang: 'it' } },
        })
        expect(adminLanguage.ok()).toBe(true)
        await page.goto(base + '/~/admin/#/plugins/installed')
        await page.getByRole('button', { name: 'Opzioni', exact: true }).click()
        await expect(page.getByRole('combobox', { name: 'Cartella da ripulire' })).toBeVisible()
        await expect(page.getByText('Algoritmi da indicizzare', { exact: true })).toBeVisible()
        await expect(page.getByText('SHA-512 permette anche di calcolare', { exact: false })).toBeVisible()
        await page.getByRole('button', { name: 'Ripulisci i file rimossi', exact: true }).click()
        await expect(page.getByText('Rimuovere gli hash salvati', { exact: false })).toBeVisible()
        await page.getByRole('button', { name: 'Vai', exact: true }).click()
        await expect(page.getByText('Rimossi 0 record; conservati 2.', { exact: true })).toBeVisible()
        await rename(join(cwd, 'shared'), join(cwd, 'shared-offline'))
        try {
            await page.getByRole('button', { name: 'Ripulisci i file rimossi', exact: true }).click()
            await page.getByRole('button', { name: 'Vai', exact: true }).click()
            await expect(page.getByText('La cartella è scollegata o non leggibile; nessun record è stato rimosso', { exact: false })).toBeVisible()
        }
        finally { await rename(join(cwd, 'shared-offline'), join(cwd, 'shared')) }
        const adminBeforeUnload = await page.request.get(base + '/~/admin/')
        expect(await adminBeforeUnload.text()).toContain('hashSearch_root')
        const stopped = await page.request.post(base + '/~/api/stop_plugin', {
            headers: { 'x-hfs-anti-csrf': '1' }, data: { id: 'renamed-search' },
        })
        expect(stopped.ok()).toBe(true)
        // after the language cache expires, unloaded plugin keys must not remain in embedded catalogs
        await expect.poll(async () => (await (await page.request.get(base + '/~/admin/')).text()).includes('hashSearch_root'), { timeout: 10000 }).toBe(false)

        expect(errors).toEqual([])
    }
    finally {
        releaseStatus?.()
        await writeFile(join(cwd, 'release'), '')
        child.kill()
        await exited
        await rm(cwd, { recursive: true, force: true, maxRetries: 5 })
    }
})
