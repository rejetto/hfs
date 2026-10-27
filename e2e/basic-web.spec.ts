import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FRONTEND_URL, username, password } from './common'

test.use({
    javaScriptEnabled: false,
    userAgent: 'Mozilla/5.0 (Windows NT 6.1; rv:10.0) Gecko/20100101 Firefox/10.0',
})

test.beforeEach(async ({ page }) => {
    await page.goto(FRONTEND_URL + 'for-admins/upload/')
    await page.getByLabel('Username:', { exact: true }).fill(username)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(page.getByRole('button', { name: `Logout (${username})`, exact: true })).toBeVisible()
})

test('basic ZIP link downloads the current folder and respects archive permissions', async ({ page }) => {
    await page.goto(FRONTEND_URL + 'f1/f2/?get=basic')
    const link = page.getByRole('link', { name: 'Download ZIP', exact: true })
    await expect(link).toHaveAttribute('href', '?get=zip')
    const downloading = page.waitForEvent('download')
    await link.click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('f2.zip')
    expect(await download.failure()).toBeNull()
    await page.goto(FRONTEND_URL + 'cantSeeThisButChildren/?get=basic')
    await expect(page.getByRole('link', { name: '..', exact: true })).toBeVisible()
    await expect(link).toHaveCount(0)
})

test('basic upload works without JavaScript and returns to the folder', async ({ page }, testInfo) => {
    const names = ['basic', 'bàsic-é'].map(prefix => `${prefix}-${testInfo.project.name}-${Date.now()}.txt`)
    const paths = names.map(name => resolve('tests/tmp', name))
    try {
        await page.goto(FRONTEND_URL + 'for-admins/upload/')
        const form = page.locator('form[enctype="multipart/form-data"]')
        await expect(form).toHaveAttribute('method', 'post')
        await expect(form).toHaveAttribute('enctype', 'multipart/form-data')
        await page.getByLabel('Files:').setInputFiles(names.map(name => ({
            name, mimeType: 'text/plain', buffer: Buffer.from(name),
        })))
        await page.getByRole('button', { name: 'Upload', exact: true }).click()
        await expect(page.getByText('Uploaded files: 2', { exact: true })).toBeVisible()
        for (const [i, path] of paths.entries())
            expect(readFileSync(path, 'utf8')).toBe(names[i])
        await page.getByRole('link', { name: 'Back', exact: true }).click()
        await expect(page).toHaveURL(/\?get=basic$/)
        for (const name of names)
            await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
        await testInfo.attach('basic-upload', { body: await page.screenshot(), contentType: 'image/png' })
    }
    finally {
        await Promise.all(paths.map(path => rm(path, { force: true })))
    }
})

test('basic upload is hidden in read-only and virtual folders', async ({ page }) => {
    for (const path of ['for-admins/', 'renameChild/tests/', 'renameChild/']) {
        await page.goto(FRONTEND_URL + path + '?get=basic')
        await expect(page.getByRole('button', { name: /Logout/ })).toBeVisible()
        await expect(page.locator('input[type="file"]')).toHaveCount(0)
    }
})

test('basic upload reports empty selections and denied uploads', async ({ page }) => {
    for (const [path, name, status, message] of [
        ['for-admins/upload/', '', 400, 'empty filename'],
        ['renameChild/tests/', 'basic-denied.txt', 403, 'Forbidden'],
    ] as const) {
        const response = await page.request.post(FRONTEND_URL + path + '?get=basic', {
            headers: { 'content-type': 'multipart/form-data; boundary=hfs-basic-test' },
            data: `--hfs-basic-test\r\nContent-Disposition: form-data; name="upload"; filename="${name}"\r\n\r\ntest\r\n--hfs-basic-test--\r\n`,
        })
        expect(response.status()).toBe(status)
        expect(response.headers()['content-type']).toContain('text/html')
        await page.setContent(await response.text())
        await expect(page.getByText('Uploaded files: 0', { exact: true })).toBeVisible()
        await expect(page.getByText(message, { exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveAttribute('href', '?get=basic')
    }
})
