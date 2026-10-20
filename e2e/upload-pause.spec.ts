import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { UPLOAD_TEMP_PREFIX, UPLOAD_KEEP_ALIVE_SECONDS } from '../src/cross-const'
import { FRONTEND_URL, username, password } from './common'

test('paused upload survives immediate cleanup, renews and resumes its bytes', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'upload throttling uses Chromium network emulation')
    const filename = `pause-${Date.now()}.txt`
    const temp = resolve('tests/tmp', UPLOAD_TEMP_PREFIX + filename)
    const final = resolve('tests/tmp', filename)
    const content = Buffer.alloc(512 * 1024, 'abcdefgh')
    const events: string[] = []
    let heartbeats = 0
    page.on('response', response => {
        if (response.url().endsWith('/~/api/keep_upload_alive') && response.ok()) {
            heartbeats++
            events.push('ack')
        }
    })
    page.on('requestfailed', request => {
        if (request.method() === 'PUT') events.push('abort')
    })
    await page.clock.install()
    await page.goto(FRONTEND_URL + 'for-admins/upload/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Upload' })).toBeEnabled()
    const old = await api('get_config', { only: ['delete_unfinished_uploads_after'] })
    const network = await page.context().newCDPSession(page)
    await network.send('Network.enable')
    try {
        await api('set_config', { values: { delete_unfinished_uploads_after: 0 } })
        await network.send('Network.emulateNetworkConditions', {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 64 * 1024,
        })
        await page.getByRole('button', { name: 'Upload' }).click()
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Pick files' }).click()
        await (await chooser).setFiles({ name: filename, mimeType: 'text/plain', buffer: content })
        await page.getByRole('button', { name: 'Send' }).click()
        await expect.poll(() => existsSync(temp) && statSync(temp).size > 0).toBe(true)
        await page.getByTitle('Pause', { exact: true }).click()
        await expect(page.getByTitle('Play', { exact: true })).toBeEnabled()
        await expect.poll(() => events.includes('abort')).toBe(true)
        expect(events.indexOf('ack')).toBeLessThan(events.indexOf('abort'))
        // client abort finishes before the server has necessarily closed its file stream
        await expect.poll(() => existsSync(temp) && statSync(temp).size, { timeout: 3000 }).toBeGreaterThan(0)
        await page.waitForTimeout(1100)
        const partial = readFileSync(temp)
        expect(partial.length).toBeLessThan(content.length)
        expect(partial.equals(content.subarray(0, partial.length))).toBe(true)
        await test.info().attach('upload-paused', { body: await page.screenshot(), contentType: 'image/png' })
        const beforeRenewal = heartbeats
        await page.clock.fastForward(UPLOAD_KEEP_ALIVE_SECONDS * 1000)
        await expect.poll(() => heartbeats).toBe(beforeRenewal + 1)
        expect(readFileSync(temp).equals(partial)).toBe(true)
        await network.send('Network.emulateNetworkConditions', {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        })
        const resumed = page.waitForRequest(request => request.method() === 'PUT'
            && Number(new URL(request.url()).searchParams.get('resume')?.replace('!', '')) > 0)
        await page.getByTitle('Play', { exact: true }).click()
        expect(Number(new URL((await resumed).url()).searchParams.get('resume')?.replace('!', ''))).toBe(partial.length)
        await expect.poll(() => existsSync(final)).toBe(true)
        expect(readFileSync(final).equals(content)).toBe(true)
        const afterResume = heartbeats
        await page.clock.fastForward(UPLOAD_KEEP_ALIVE_SECONDS * 2 * 1000)
        expect(heartbeats).toBe(afterResume)
    }
    finally {
        await network.detach()
        await api('set_config', { values: old })
        await page.request.delete(new URL('for-admins/upload/' + filename, FRONTEND_URL).href)
    }

    async function api(command: string, params: object) {
        const response = await page.request.post(new URL('~/api/' + command, FRONTEND_URL).href, {
            headers: { 'x-hfs-anti-csrf': '1' }, data: params,
        })
        expect(response.ok(), await response.text()).toBe(true)
        return response.json()
    }
})

test('failed protection keeps uploading and clearing the queue cancels a pending pause', async ({ page }) => {
    let heartbeats = 0
    let uploads = 0
    let aborted = false
    let releaseAck!: () => void
    const heldAck = new Promise<void>(resolve => releaseAck = resolve)
    page.on('requestfailed', request => {
        if (request.method() === 'PUT') aborted = true
    })
    await page.clock.install()
    await page.route('**/*', async route => {
        if (route.request().url().endsWith('/~/api/keep_upload_alive')) {
            if (++heartbeats === 1)
                return route.fulfill({ status: 503, body: 'protection unavailable' })
            await heldAck
            return route.fulfill({ json: { keepAlive: true } })
        }
        if (route.request().method() === 'PUT') {
            if (++uploads === 1) {
                await heldAck
                return route.abort().catch(() => {})
            }
            return route.fulfill({ json: {} })
        }
        return route.continue()
    })
    try {
        await page.goto(FRONTEND_URL + 'for-admins/upload/')
        await page.getByRole('textbox', { name: 'Username' }).fill(username)
        await page.getByRole('textbox', { name: 'Password' }).fill(password)
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Upload' }).click()
        await addFile('first.txt')
        await expect.poll(() => uploads).toBe(1)
        await addFile('queued.txt')
        await page.getByTitle('Pause', { exact: true }).click()
        await expect(page.getByRole('alertdialog')).toContainText('protection unavailable')
        expect(aborted).toBe(false)
        await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click()
        await expect(page.getByTitle('Pause', { exact: true })).toBeEnabled()
        await expect(page.getByTitle('Play', { exact: true })).toHaveCount(0)
        await page.getByTitle('Pause', { exact: true }).click()
        await expect.poll(() => heartbeats).toBe(2)
        await expect(page.getByTitle('Pause', { exact: true })).toBeDisabled()
        expect(aborted).toBe(false)
        await page.getByTitle('Clear', { exact: true }).click()
        await expect.poll(() => aborted).toBe(true)
        releaseAck()
        await addFile('second.txt')
        await expect.poll(() => uploads).toBe(2)
        await page.clock.fastForward(UPLOAD_KEEP_ALIVE_SECONDS * 2 * 1000)
        expect(heartbeats).toBe(2)
    }
    finally {
        releaseAck()
    }

    async function addFile(name: string) {
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Pick files' }).click()
        await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })
        await page.getByRole('button', { name: 'Send' }).click()
    }
})

test('pause stops the queue when the current file finishes before its acknowledgement', async ({ page }) => {
    let uploads = 0
    let releaseFile!: () => void
    let releaseAck!: () => void
    let acknowledgeRequested!: () => void
    const finishFile = new Promise<void>(resolve => releaseFile = resolve)
    const finishAck = new Promise<void>(resolve => releaseAck = resolve)
    const ackRequested = new Promise<void>(resolve => acknowledgeRequested = resolve)
    await page.route('**/*', async route => {
        if (route.request().url().endsWith('/~/api/keep_upload_alive')) {
            acknowledgeRequested()
            await finishAck
            return route.fulfill({ status: 404, body: 'upload already finished' })
        }
        if (route.request().method() === 'PUT') {
            if (++uploads === 1) await finishFile
            return route.fulfill({ json: {} })
        }
        return route.continue()
    })
    try {
        await page.goto(FRONTEND_URL + 'for-admins/upload/')
        await page.getByRole('textbox', { name: 'Username' }).fill(username)
        await page.getByRole('textbox', { name: 'Password' }).fill(password)
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Upload' }).click()
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Pick files' }).click()
        await (await chooser).setFiles(['first.txt', 'second.txt'].map(name => ({
            name, mimeType: 'text/plain', buffer: Buffer.from(name),
        })))
        await page.getByRole('button', { name: 'Send' }).click()
        await expect.poll(() => uploads).toBe(1)
        await page.getByTitle('Pause', { exact: true }).click()
        await ackRequested
        releaseFile()
        await expect(page.getByRole('dialog')).toContainText('1 finished')
        expect(uploads).toBe(1)
        releaseAck()
        await expect(page.getByTitle('Play', { exact: true })).toBeEnabled()
        await expect(page.getByRole('alertdialog')).toHaveCount(0)
        await page.getByTitle('Play', { exact: true }).click()
        await expect.poll(() => uploads).toBe(2)
    }
    finally {
        releaseFile()
        releaseAck()
    }
})
