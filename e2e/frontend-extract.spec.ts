import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ZipFile } from 'yazl'

test('extract menu, two concurrent jobs, private details and Stop', async ({ page, browser }, info) => {
    test.setTimeout(60000)
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-extract-ui-'))
    await mkdir(join(cwd, 'share'))
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, log: '', error_log: '', enable_plugins: [],
        accounts: { admin: { password: 'secret', admin: true } },
        vfs: { source: join(cwd, 'share'), can_upload: true, can_delete: true },
    }))
    const zip = new ZipFile()
    // Enough real files to interact with two jobs while they are still writing, without synthetic delays.
    for (let i = 0; i < 12000; i++) zip.addBuffer(Buffer.alloc(16384, 42), `${i}.txt`)
    zip.end()
    await pipeline(zip.outputStream, createWriteStream(join(cwd, 'share/one.zip')))
    await copyFile(join(cwd, 'share/one.zip'), join(cwd, 'share/two.zip'))
    const shortZip = new ZipFile()
    for (let i = 0; i < 600; i++) shortZip.addBuffer(Buffer.from('done'), `done-${i}.txt`)
    shortZip.end()
    await pipeline(shortZip.outputStream, createWriteStream(join(cwd, 'share/done.zip')))
    const child = spawn(process.execPath, [resolve('dist/src/index.js'), '--cwd', cwd, '--no-central'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stopped = once(child, 'exit')
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    const observer = await browser.newPage()
    const admin = await browser.newPage()
    try {
        await expect.poll(() => output).toMatch(/Serving on http:\/\/127\.0\.0\.1:\d+/)
        const base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]
        const observerRequests: string[] = []
        observer.on('request', request => observerRequests.push(request.url()))
        await Promise.all([page.goto(base), observer.goto(base), admin.goto(base)])
        await admin.getByRole('button', { name: 'Login', exact: true }).click()
        await admin.getByRole('textbox', { name: 'Username', exact: true }).fill('admin')
        await admin.getByRole('textbox', { name: 'Password', exact: true }).fill('secret')
        await admin.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(admin.getByRole('button', { name: 'admin', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'one.zip', exact: true })).toBeVisible()
        expect(observerRequests.some(url => url.includes('/get_extractions'))).toBe(false)
        await start('one.zip')
        await expect(page.getByRole('tab', { name: 'one.zip' })).toBeVisible()
        await page.locator('.extractions-dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await start('two.zip')
        await expect(page.getByRole('tab')).toHaveCount(2)
        await page.locator('.extractions-dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await expect(page.locator('#extraction-indicator')).toContainText(/% \(2\)/)
        await page.locator('#extraction-indicator').click()
        await expect(page.getByRole('tab', { name: 'two.zip' })).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('tab', { name: 'one.zip' }).click()
        await expect(page.getByRole('tabpanel')).toContainText('/one.zip')
        await observer.getByRole('link', { name: 'one.zip', exact: true }).click()
        await expect(observer.locator('#menu-entry-extract')).toContainText(/Extracting \d+%/)
        expect(observerRequests.some(url => url.includes('/get_extraction_progress'))).toBe(true)
        expect(observerRequests.some(url => url.includes('/get_extractions'))).toBe(false)
        await expect(observer.locator('#extraction-indicator')).toHaveCount(0)
        await expect(admin.locator('#extraction-indicator')).toContainText(/% \(2\)/)
        await admin.locator('#extraction-indicator').click()
        await expect(admin.getByRole('tab')).toHaveCount(2)
        await info.attach('extraction-details', { body: await page.screenshot(), contentType: 'image/png' })
        await page.getByRole('button', { name: 'Stop', exact: true }).click()
        await expect(page.getByRole('tabpanel')).toContainText('Stopped')
        await expect(observer.locator('#menu-entry-extract')).toContainText(/Stopped \d+%/)
        await page.getByRole('tab', { name: 'two.zip' }).click()
        await page.getByRole('button', { name: 'Stop', exact: true }).click()
        await expect(page.getByRole('tabpanel')).toContainText('Stopped')
        await page.locator('.extractions-dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await expect(page.getByRole('link', { name: 'output, Folder', exact: true })).toBeVisible()
        await observer.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await expect(observer.getByRole('link', { name: 'output, Folder', exact: true })).toHaveCount(0)
        await observer.getByRole('link', { name: 'one.zip', exact: true }).click()
        await expect(observer.locator('#menu-entry-extract')).toHaveText('Extract')
        await observer.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await observer.getByRole('link', { name: 'done.zip', exact: true }).click()
        await start('done.zip')
        await expect(observer.locator('#menu-entry-extract')).toContainText(/Extracting \d+%/)
        await expect(observer.locator('#menu-entry-extract')).toHaveText('Completed 100%', { timeout: 20000 })
        await info.attach('completed-file-menu', { body: await observer.screenshot(), contentType: 'image/png' })
        await observer.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await observer.getByRole('link', { name: 'done.zip', exact: true }).click()
        await expect(observer.locator('#menu-entry-extract')).toHaveText('Extract')

        // restore a long-lived tab's credentials after old jobs have expired on the server
        await page.evaluate(() => {
            const ids = JSON.parse(sessionStorage.getItem('hfs-extractions') || '[]')
            sessionStorage.setItem('hfs-extractions', JSON.stringify([
                ...ids, ...Array.from({ length: 800 }, () => crypto.randomUUID()),
            ]))
        })
        await page.route('**/get_extractions', route => route.abort(), { times: 1 })
        await page.reload()
        await page.locator('#extraction-indicator').click()
        await expect(page.getByRole('tab')).toHaveCount(3)
        await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('hfs-extractions') || '[]').length)).toBe(3)

        const emptyZip = new ZipFile()
        emptyZip.end()
        await pipeline(emptyZip.outputStream, createWriteStream(join(cwd, 'share/empty.zip')))
        const retainedIds: string[] = []
        for (let i = 0; i < 105; i++) {
            const name = i === 104 ? 'one.zip' : `empty-${i}.zip`
            if (i !== 104) await copyFile(join(cwd, 'share/empty.zip'), join(cwd, 'share', name))
            const response = await page.request.post(base + '/~/api/extract_archive', {
                headers: { 'x-hfs-anti-csrf': '1' }, data: { uri: '/' + name, dest: 'poll-output' },
            })
            expect(response.ok()).toBe(true)
            retainedIds.push((await response.json()).id)
        }
        await page.evaluate(ids => {
            const previous = JSON.parse(sessionStorage.getItem('hfs-extractions') || '[]')
            sessionStorage.setItem('hfs-extractions', JSON.stringify([...previous, ...ids]))
        }, retainedIds)
        await page.reload()
        await page.locator('#extraction-indicator').click()
        await expect(page.getByRole('tab')).toHaveCount(108)
        await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('hfs-extractions') || '[]').length)).toBe(108)
        await expect(page.getByRole('tabpanel')).toContainText('Extracting')
        await page.getByRole('button', { name: 'Stop', exact: true }).click()
        await expect(page.getByRole('tabpanel')).toContainText('Stopped')
    }
    finally {
        await Promise.all([observer.close(), admin.close()])
        child.kill()
        await stopped
        await rm(cwd, { recursive: true, force: true })
    }

    async function start(name: string) {
        await page.getByRole('link', { name, exact: true }).click()
        await page.locator('#menu-entry-extract').click()
        const dialog = page.locator('.dialog-prompt')
        await expect(dialog.getByRole('textbox')).toHaveValue(name.replace('.zip', ''))
        await dialog.getByRole('textbox').fill('output')
        await dialog.getByRole('button', { name: 'Continue' }).click()
        await page.locator('.dialog-confirm').getByRole('button', { name: 'Yes' }).click()
        await expect(page.locator('.extractions-dialog')).toBeVisible()
    }
})
