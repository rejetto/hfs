import { expect, test } from '@playwright/test'
import { clearUploads, clickAdminMenu, clickIconBtn, loginAdmin, password, uploadName, URL, username } from './common'

// this test is separated to run serially, as it will modify folder timestamp for a few seconds, during which other tests may fail
test.describe.configure({ mode: 'serial' }) // to disconnect the upload consistently, i need only 1 upload at a time

export const fileToUpload = {
    name: 'upload-test.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(100_000),
}

test('upload1', async ({ page, context, browserName }) => {
    if (browserName !== 'chromium') return // only chromium has cdpSession
    await page.goto(URL)
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
    await pageAdmin.goto(URL + '~/admin/#/monitoring'); // cross-device way of changing page
    await page.locator('div').filter({ hasText: 'xOptionsAdmin-panelSort by:' }).nth(2).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Upload' }).click()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Pick files' }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(fileToUpload)
    // can't do without. I tried using route.continue, but i can't send half-body keeping the full content-length, and i also cannot pass a stream (to throttle)
    const cdpSession = await context.newCDPSession(page)
    await cdpSession.send('Network.emulateNetworkConditions', NETWORK_PRESETS.Regular2G)
    await page.getByRole('button', { name: 'Edit' }).click()
    const renameDialog = page.locator('.dialog-prompt')
    const renameInput = renameDialog.getByRole('textbox')
    await expect(renameInput).toHaveValue(fileToUpload.name) // promptDialog initializes the field value in useEffect, so we wait for that init to avoid our fill being overwritten
    await renameInput.fill(uploadName)
    await renameDialog.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(uploadName)).toBeVisible() // rename was effective
    await page.getByRole('button', { name: 'Send 1 file' }).click()
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
})

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
test('admin2', async ({ page }) => {
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
    const adminAccess = page.getByRole('checkbox', { name: 'Admin-panel access' })
    await adminAccess.check()
    await expect(adminAccess).toBeChecked()
    await page.getByRole('textbox', { name: 'Notes' }).fill('admin2 expanded interactions')
    if (isPhone)
        await clickIconBtn('Close', page)

    await clickAdminMenu(page, 'Options')
    await expect(page.getByText('Correctly working on port')).toBeVisible()
    await page.getByRole('button', { name: 'Reload' }).click()
    await page.getByRole('row', { name: /^Blocked/ }).getByRole('button', { name: /Add/ }).click()
    const addDialog = page.getByRole('dialog').filter({ hasText: 'Add' })
    await addDialog.getByRole('textbox', { name: 'Blocked IP' }).fill('5.6.7.8')
    if (!isPhone) {
        // This field uses a masked input: selecting from picker is more reliable than typing.
        await addDialog.getByRole('button', { name: 'Choose date' }).click()
        const picker = page.locator('.MuiPickersPopper-root[role="dialog"]')
        await picker.locator('button.MuiPickersDay-root:not([disabled])').first().click()
        // Close the popper so it doesn't intercept clicks on the Add dialog buttons.
        await page.keyboard.press('Escape')
        await expect(addDialog.getByRole('textbox', { name: 'Expire' })).not.toHaveValue('MM/DD/YYYY hh:mm aa')
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
        const logApisToggle = logsDialog.getByRole('checkbox', { name: 'Log API requests' })
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
    if (!isPhone) {
        await clickIconBtn('Start download-counter', page)
        await clickIconBtn('Options', page)
        const whereField = page.getByRole('combobox', { name: 'Where to display counter' })
        await whereField.click()
        await page.getByRole('option', { name: 'list', exact: true }).click()
        const pluginOptionsDialog = page.getByRole('dialog')
        const pluginSaveBtn = pluginOptionsDialog.locator('button:has-text("Save")').first()
        await expect(pluginSaveBtn).toBeEnabled()
        await clickIconBtn('Close', page)
        await clickIconBtn('Stop download-counter', page)
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
