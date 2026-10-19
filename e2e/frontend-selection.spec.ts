import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Open } from 'unzipper'

test('anonymous selection exposes actions allowed on individual files', async ({ page }, testInfo) => {
    const cwd = testInfo.outputPath('server')
    await mkdir(join(cwd, 'files'), { recursive: true })
    await writeFile(join(cwd, 'files/alfa.txt'), 'alpha')
    await writeFile(join(cwd, 'files/beta.txt'), 'beta')
    await writeFile(join(cwd, 'files/delete-only.bin'), 'delete only')
    await mkdir(join(cwd, 'no-zip'))
    await writeFile(join(cwd, 'no-zip/delete-only.bin'), 'delete only')
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '',
        vfs: { children: [{ name: 'files', source: join(cwd, 'files'), can_archive: false, can_delete: false,
            masks: { '*.txt': { can_archive: true }, 'beta.txt': { can_archive: true, can_delete: true },
                'delete-only.bin': { can_delete: true } },
        }, {
            name: 'no-zip', source: join(cwd, 'no-zip'), can_archive: false, can_delete: true,
            children: [{ name: 'link', url: 'https://example.com', can_archive: true }],
        }, {
            name: 'filter-only', source: join(cwd, 'no-zip'), can_archive: false, can_delete: false,
        }] },
    }))
    const child = spawn(process.execPath, [resolve('dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    let output = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    try {
        await expect.poll(() => /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]).toBeTruthy()
        const base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]
        await page.goto(base + '/files/?lang=en')
        await expect(page.getByRole('link', { name: 'alfa.txt', exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible()
        await expect(page.locator('#zip-button')).toBeHidden()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await expect(page.locator('#filter')).not.toBeFocused()
        const zip = page.locator('#zip-button')
        await expect(zip).toBeVisible()
        await expect(zip.getByRole('button')).toBeDisabled()
        const alfa = page.getByRole('checkbox', { name: 'alfa.txt', exact: true })
        const beta = page.getByRole('checkbox', { name: 'beta.txt', exact: true })
        const deleteOnly = page.getByRole('checkbox', { name: 'delete-only.bin', exact: true })
        await deleteOnly.check()
        await expect(zip.getByRole('button')).toBeDisabled()
        await deleteOnly.uncheck()
        await alfa.check()
        await expect(zip.getByRole('button')).toBeEnabled()
        await expect(page.locator('#delete-button')).toHaveCount(0)
        await expect(page.locator('#cut-button')).toHaveCount(0)
        await downloadZip(['alfa.txt'])

        await beta.check()
        await deleteOnly.check()
        await downloadZip(['alfa.txt', 'beta.txt'])
        await deleteOnly.uncheck()
        await alfa.uncheck()
        await expect(page.locator('#delete-button')).toBeEnabled()
        await expect(page.locator('#cut-button')).toBeEnabled()
        await page.locator('#cut-button').click()
        await expect(page.getByRole('button', { name: /Clipboard/ })).toBeVisible()
        await beta.uncheck()
        await expect(zip).toBeVisible()
        await expect(zip.getByRole('button')).toBeDisabled()
        await expect(page.locator('#delete-button')).toHaveCount(0)
        await expect(page.locator('#cut-button')).toHaveCount(0)
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await expect(zip).toBeHidden()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await expect(zip).toBeVisible()
        await expect(zip.getByRole('button')).toBeDisabled()

        await beta.check()
        await page.locator('#delete-button').click()
        // the list can disappear during a refresh before deletion has finished on disk
        const deleted = page.waitForResponse(response => response.request().method() === 'DELETE'
            && new URL(response.url()).pathname === '/files/beta.txt')
        await page.getByRole('button', { name: 'Yes', exact: true }).click()
        expect((await deleted).status()).toBe(200)
        await expect(page.getByRole('link', { name: 'beta.txt', exact: true })).toHaveCount(0)
        await expect(readFile(join(cwd, 'files/beta.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readFile(join(cwd, 'files/alfa.txt'), 'utf8')).toBe('alpha')
        await page.goto(base + '/?lang=en')
        await expect(zip).toBeVisible()
        await expect(zip.getByRole('button')).toBeEnabled()
        await page.getByRole('button', { name: 'Filter', exact: true }).click()
        await expect(page.locator('#filter')).toBeFocused()
        await expect(zip.getByRole('button')).toBeEnabled()
        await page.goto(base + '/no-zip/?lang=en')
        await expect(page.getByRole('link', { name: 'delete-only.bin', exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
        await expect(zip).toBeHidden()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await expect(zip).toHaveAttribute('aria-hidden', 'true')
        await expect(zip).toBeHidden()
        await page.getByRole('checkbox', { name: 'delete-only.bin', exact: true }).check()
        await expect(page.locator('#delete-button')).toBeEnabled()
        await expect(zip).toBeHidden()
        await page.goto(base + '/filter-only/?lang=it')
        await expect(page.getByRole('button', { name: 'Filtra', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Filtra', exact: true }).click()
        await expect(page.getByRole('checkbox')).toHaveCount(0)
        await expect(page.locator('#filter')).toBeFocused()
        await page.keyboard.type('missing')
        await expect(page.getByRole('link', { name: 'delete-only.bin', exact: true })).toHaveCount(0)
        await page.locator('#filter').fill('')
        await expect(page.getByRole('link', { name: 'delete-only.bin', exact: true })).toBeVisible()
        await page.locator('#filter').fill('delete')
        await page.getByRole('button', { name: 'Filtra', exact: true }).click()
        await expect(page.locator('#filter')).toBeHidden()
        await page.getByRole('button', { name: 'Filtra', exact: true }).click()
        await expect(page.locator('#filter')).toBeFocused()
        await expect(page.locator('#filter')).toHaveValue('delete')

        async function downloadZip(names: string[]) {
            const downloading = page.waitForEvent('download')
            await page.locator('#zip-button').click()
            const download = await downloading
            expect(await download.failure()).toBeNull()
            const archive = await Open.file((await download.path())!)
            expect(archive.files.map(file => file.path).sort()).toEqual(names)
        }
    }
    finally {
        child.kill()
        await exited
        await testInfo.attach('server-output', { body: output, contentType: 'text/plain' })
    }
})
