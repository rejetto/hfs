import { expect, test, type ConsoleMessage, type Page, type Request, type Response, type TestInfo } from '@playwright/test'
import { ADMIN_URL, clearUploads, clickAdminMenu, clickIconBtn, loginAdmin, password, uploadName, FRONTEND_URL, username } from './common'

// this test is separated to run serially, as it will modify folder timestamp for a few seconds, during which other tests may fail
test.describe.configure({ mode: 'serial' }) // to disconnect the upload consistently, i need only 1 upload at a time

export const fileToUpload = {
    name: 'upload-test.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(100_000),
}

test('upload1', async ({ page, context, browserName }, testInfo) => {
    if (browserName !== 'chromium') return // only chromium has cdpSession
    const diagnostics = await startUpload1Diagnostics(page)
    try {
        await page.goto(FRONTEND_URL)
        await page.getByRole('button', { name: 'Login' }).click()
        await page.getByRole('textbox', { name: 'Username' }).fill(username)
        await page.getByRole('textbox', { name: 'Password' }).fill(password)
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.locator('div').filter({ hasText: 'Logged in' }).nth(3).click()

        await page.getByRole('link', { name: 'for-admins, Folder' }).click()
        await page.getByRole('link', { name: 'upload, Folder' }).click()

        await page.getByRole('button', { name: 'Options' }).click()
        const pageAdminPromise = page.waitForEvent('popup')
        await page.getByRole('button', { name: 'Admin-panel' }).click()
        const pageAdmin = await pageAdminPromise
        diagnostics.trackPage(pageAdmin, 'admin')
        await pageAdmin.goto(ADMIN_URL + '#/monitoring'); // cross-device way of changing page
        await page.locator('div').filter({ hasText: 'xOptionsAdmin-panelSort by:' }).nth(2).click()
        await page.getByRole('button', { name: 'Close' }).click()
        await page.getByRole('button', { name: 'Upload' }).click()
        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Pick files' }).click()
        const fileChooser = await fileChooserPromise
        await fileChooser.setFiles(fileToUpload)
        // can't do without cdp to slow down the upload. I tried using route.continue, but i can't send half-body keeping the full content-length, and i also cannot pass a stream (to throttle)
        const cdpSession = await context.newCDPSession(page)
        await cdpSession.send('Network.emulateNetworkConditions', NETWORK_PRESETS.Regular2G)
        await openUploadRename(page)
        const renameDialog = page.locator('.dialog-prompt')
        const renameInput = renameDialog.getByRole('textbox')
        await expect(renameInput).toHaveValue(fileToUpload.name) // promptDialog initializes the field value in useEffect, so we wait for that init to avoid our fill being overwritten
        await renameInput.fill(uploadName)
        await renameDialog.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByText(uploadName)).toBeVisible() // rename was effective
        // we send the upload, slowly, so that we can interrupt it in the admin-panel to test the upload resume
        await page.getByRole('button', { name: 'Send' }).click()
        const uploadCells = pageAdmin.locator('.MuiDataGrid-cell')
            .filter({ hasText: uploadName })
            .filter({ hasText: '/for-admins/upload' })
        await expect(uploadCells.first()).toBeVisible()
        // during upload resume, monitoring can briefly show two rows for the same path
        await uploadCells.last().click()
        await clickIconBtn('Disconnect', pageAdmin)
        await clickIconBtn('Close', pageAdmin)
        await pageAdmin.close()
        await page.getByText('Copy links').click()
        await page.getByText('Operation successful').click()
        await page.getByRole('button', { name: 'Close' }).click()
        await cdpSession?.send('Network.emulateNetworkConditions', NETWORK_PRESETS.NoThrottle)
        clearUploads()
    }
    catch (err) {
        await diagnostics.attach(testInfo)
        throw err
    }
})

async function openUploadRename(page: Page) {
    const editButton = page.getByRole('button', { name: 'Edit' })
    if (await editButton.isVisible())
        return editButton.click()
    await page.locator('.upload-list').getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('link', { name: 'Rename' }).click()
}

const MAX_DIAGNOSTIC_LINES = 300

async function startUpload1Diagnostics(page: Page) {
    const lines: string[] = []
    const started = Date.now()
    addLine('diagnostics started')
    await page.exposeBinding('__upload1Diag', (_source, entry: Record<string, unknown>) => {
        addLine(`xhr ${formatEntry(entry)}`)
    })
    await page.addInitScript(() => {
        const originalOpen = XMLHttpRequest.prototype.open
        const originalSend = XMLHttpRequest.prototype.send
        XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
            ;(this as any).__upload1DiagRequest = { method: String(method), url: String(url) }
            return Reflect.apply(originalOpen, this, [method, url, ...args])
        }
        XMLHttpRequest.prototype.send = function(...args: any[]) {
            const req = (this as any).__upload1DiagRequest
            if (req?.method === 'PUT' && req.url.includes('/for-admins/upload/')) {
                const log = (event: string, progress?: ProgressEvent) => {
                    // record XHR state before Playwright closes the browser
                    Promise.resolve((window as any).__upload1Diag?.({
                        event,
                        readyState: this.readyState,
                        status: this.status,
                        url: req.url,
                        loaded: progress?.loaded,
                        total: progress?.lengthComputable ? progress.total : undefined,
                    })).catch(() => {})
                }
                for (const event of ['loadstart', 'abort', 'error', 'timeout', 'loadend'])
                    this.addEventListener(event, log.bind(null, event))
                this.upload.addEventListener('progress', e => log('upload-progress', e))
                this.addEventListener('readystatechange', () => log('readystatechange'))
            }
            return originalSend.apply(this, args)
        }
    })
    trackPage(page, 'main')
    return { attach, trackPage }

    function trackPage(trackedPage: Page, label: string) {
        trackedPage.on('console', msg => addLine(`console:${label} ${formatConsole(msg)}`))
        trackedPage.on('requestfailed', request => addLine(`requestfailed:${label} ${formatRequest(request)} ${request.failure()?.errorText ?? ''}`))
        trackedPage.on('response', response => {
            if (isUploadResponse(response))
                addLine(`response:${label} ${response.status()} ${response.request().method()} ${response.url()}`)
        })
    }

    async function attach(testInfo: TestInfo) {
        await testInfo.attach('upload1-diagnostics', {
            body: lines.join('\n') + '\n',
            contentType: 'text/plain',
        })
    }

    function addLine(text: string) {
        const offset = `${Date.now() - started}ms`.padStart(7)
        lines.push(`${offset} ${text}`)
        if (lines.length > MAX_DIAGNOSTIC_LINES)
            lines.splice(0, lines.length - MAX_DIAGNOSTIC_LINES)
    }

    function formatConsole(msg: ConsoleMessage) {
        return `${msg.type()} ${msg.text()}`
    }

    function formatRequest(request: Request) {
        return `${request.method()} ${request.url()}`
    }

    function isUploadResponse(response: Response) {
        const request = response.request()
        return request.method() === 'PUT' && response.url().includes('/for-admins/upload/')
    }

    function formatEntry(entry: Record<string, unknown>) {
        return Object.entries(entry)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(' ')
    }

}

const NETWORK_PRESETS = {
    Offline: {
        offline: true,
        downloadThroughput: 0,
        uploadThroughput: 0,
        latency: 0,
        connectionType: 'none',
    },
    NoThrottle: {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
    },
    Regular2G: {
        offline: false,
        downloadThroughput: (250 * 1024) / 8,
        uploadThroughput: (120 * 1024) / 8,
        latency: 300,
        connectionType: 'cellular2g',
    },
} as const

// some interactions, no screenshots
test('admin2', async ({ page, browserName }) => {
    const isPhone = await loginAdmin(page)

    await clickAdminMenu(page, 'Accounts')
    await expect(page.getByText('admins', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('menuitem', { name: 'user' }).click()
    const usernameField = page.getByRole('textbox', { name: 'Username' })
    const passwordField = page.getByRole('textbox', { name: 'Password', exact: true })
    await usernameField.fill('admin2-temp-user')
    await passwordField.fill('admin2-temp-pass')
    await page.getByRole('textbox', { name: 'Repeat password' }).fill('admin2-temp-pass')
    await expect(usernameField).toHaveValue('admin2-temp-user')
    const adminAccess = page.getByRole('switch', { name: 'Admin-panel access' })
    await adminAccess.check()
    await expect(adminAccess).toBeChecked()
    await page.getByRole('textbox', { name: 'Notes' }).fill('admin2 expanded interactions')
    if (isPhone)
        await clickIconBtn('Close', page)

    await clickAdminMenu(page, 'Options')
    await expect(page.getByText('Correctly working on port')).toBeVisible()
    await page.getByRole('button', { name: 'Reload' }).click()
    await page.getByRole('row', { name: /^Blocked/ }).getByRole('button', { name: /Add/ }).click()
    const addDialog = page.getByRole('dialog', { name: /Add/ })
    await addDialog.getByRole('textbox', { name: 'Blocked IP' }).fill('5.6.7.8')
    if (!isPhone) {
        // This field uses a masked input: selecting from picker is more reliable than typing.
        await addDialog.getByRole('button', { name: 'Choose date' }).click()
        const picker = page.getByRole('dialog', { name: 'Expire' })
        // desktop calendars render hidden fillers and disabled days as gridcells too, so click a real enabled day button
        await picker.locator('button[role="gridcell"]:not([disabled]):not([aria-disabled="true"])').first().click()
        await page.keyboard.press('Escape')
    }
    await addDialog.getByRole('button').last().click()
    await expect(addDialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Options', exact: true })).toBeVisible() // still on the same page
    await expect(page.getByText('5.6.7.8')).toBeVisible()
    await page.getByRole('button', { name: 'Reload' }).click()
    await expect(page.getByText('5.6.7.8')).not.toBeVisible()

    await clickAdminMenu(page, 'Logs')
    await expect(page.getByRole('tab', { name: 'Served', exact: true })).toBeVisible()
    const logTabs = page.getByRole('tab')
    await logTabs.nth(1).click()
    await logTabs.nth(2).click()
    await logTabs.nth(3).click()
    await logTabs.nth(4).click()
    const pauseBtn = page.getByLabel('Pause').getByRole('button')
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true')
    await pauseBtn.click()
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false')
    await pauseBtn.click()
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true')
    const showApisBtn = page.getByRole('button', { name: 'Show APIs' })
    await expect(showApisBtn).toHaveAttribute('aria-pressed', 'true')
    await showApisBtn.click()
    await expect(showApisBtn).toHaveAttribute('aria-pressed', 'false')
    await showApisBtn.click()
    await expect(showApisBtn).toHaveAttribute('aria-pressed', 'true')
    await clickIconBtn('Options', page)
    if (!isPhone) {
        const logsDialog = page.getByRole('dialog', { name: /Log options/ })
        const logApisToggle = logsDialog.getByRole('switch', { name: 'Log API requests' })
        await expect(logApisToggle).toBeChecked()
        await logApisToggle.click()
        await expect(logApisToggle).not.toBeChecked()
        await logApisToggle.click()
        await expect(logApisToggle).toBeChecked()
    }
    await clickIconBtn('Close', page)

    await clickAdminMenu(page, 'Plugins')
    await expect(page.getByText('antibrute')).toBeVisible()
    const pluginTabs = page.getByRole('tab')
    await pluginTabs.nth(0).click()
    // plugin state is shared by all browser projects, so mutate it from one project to avoid cross-browser races
    if (!isPhone && browserName === 'chromium') {
        const downloadCounterRow = page.getByRole('row', { name: /download-counter/ })
        const startDownloadCounter = downloadCounterRow.getByRole('button', { name: 'Start download-counter' })
        const stopDownloadCounter = downloadCounterRow.getByRole('button', { name: 'Stop download-counter' })
        // keep the test independent from whatever state a previous run left this plugin in
        const wasRunning = await stopDownloadCounter.isVisible()
        if (!wasRunning)
            await startDownloadCounter.click()
        await downloadCounterRow.getByRole('button', { name: 'Options' }).click()
        const whereField = page.getByRole('combobox', { name: 'Where to display counter' })
        await whereField.click()
        await page.getByRole('option', { name: 'list', exact: true }).click()
        const pluginOptionsDialog = page.getByRole('dialog')
        const pluginSaveBtn = pluginOptionsDialog.locator('button:has-text("Save")').first()
        await expect(pluginSaveBtn).toBeEnabled()
        await clickIconBtn('Close', page)
        if (!wasRunning)
            await stopDownloadCounter.click()
    }
    await pluginTabs.nth(1).click() // get more
    await page.getByRole('textbox', { name: 'Search text' }).fill('download')

    await clickAdminMenu(page, 'Custom HTML')
    const sectionStyle = page.getByRole('combobox', { name: 'Section Style' })
    await expect(sectionStyle).toBeVisible()
    await sectionStyle.click()
    await page.getByRole('option').nth(1).click()

    await clickAdminMenu(page, 'Internet')
    await expect(page.getByText('Server')).toBeVisible()

    await clickAdminMenu(page, 'Logout')
})
