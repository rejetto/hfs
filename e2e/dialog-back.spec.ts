import { test, expect, Page } from '@playwright/test'
import { clickAdminMenu, loginAdmin } from './common'

const pluginId = 'test'

function pluginRow(page: Page) {
    return page.getByRole('grid').getByRole('button', { name: /^Options$/ }).locator('xpath=ancestor::*[@role="row"][1]')
}

async function ensureAuthAndGoPlugins(page: Page) {
    // loginAdmin doesn't wait for auth completion — navigate to Options first to confirm
    await clickAdminMenu(page, 'Options')
    await expect(page.getByText('Correctly working on port')).toBeVisible({ timeout: 10_000 })
    await clickAdminMenu(page, 'Plugins')
    // wouter navigation settles slightly after the click; wait until the transient dialog marker is gone before using the page as a baseline
    await expect.poll(() => page.evaluate(() => history.state?.$dialog), { timeout: 10_000 }).toBeUndefined()
    await page.waitForTimeout(1000)
    const row = pluginRow(page)
    await expect(row).toBeVisible({ timeout: 10_000 })
    const startButton = row.getByRole('button', { name: new RegExp(`^Start ${pluginId}$`) })
    if (await startButton.count())
        await startButton.click()
}

async function open3NestedDialogs(page: Page) {
    // dialog 1: test plugin config
    const row = pluginRow(page)
    await row.getByRole('button', { name: 'Options' }).click()
    await expect(page.getByText(`Options for ${pluginId}`)).toBeVisible({ timeout: 5000 })

    // dialog 2: Add entry in ArrayField
    await page.getByRole('button', { name: 'Add' }).click()
    const addDialog = page.getByRole('dialog', { name: /Add/ })
    await expect(addDialog).toBeVisible({ timeout: 5000 })

    // dialog 3: Browse files picker (inside Add dialog)
    await addDialog.getByRole('button', { name: 'Browse files...' }).click()
    await expect(page.locator('.MuiDialog-root')).toHaveCount(3, { timeout: 5000 })
}

async function pressTopDialogEscape(page: Page, remainingDialogs: number) {
    await page.locator('.MuiDialog-container').last().press('Escape')
    await expect(page.locator('.MuiDialog-root')).toHaveCount(remainingDialogs, { timeout: 5000 })
}

async function expectDialogsClosed(page: Page) {
    await expect(page.locator('.MuiDialog-root')).toHaveCount(0, { timeout: 10_000 })
    await page.waitForTimeout(3000)
    await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible({ timeout: 10_000 })
}

test('nested dialog ESC does not overshoot history', async ({ page }) => {
    await loginAdmin(page)
    await ensureAuthAndGoPlugins(page)

    await open3NestedDialogs(page)

    // close all 3 dialogs via ESC
    for (const remainingDialogs of [2, 1, 0])
        await pressTopDialogEscape(page, remainingDialogs)

    await expectDialogsClosed(page)
    expect(page.url()).toContain('~/admin')
})

test('nested dialog browser-back does not overshoot', async ({ page }) => {
    await loginAdmin(page)
    await ensureAuthAndGoPlugins(page)

    await open3NestedDialogs(page)

    // rapid browser back ×3
    await page.evaluate(() => {
        setTimeout(() => history.back(), 0)
        setTimeout(() => history.back(), 1000)
        setTimeout(() => history.back(), 2000)
    })

    await page.waitForTimeout(3000)

    await expectDialogsClosed(page)
    expect(page.url()).toContain('~/admin')
})

test('repeated nested dialog open/close cycles', async ({ page }) => {
    await loginAdmin(page)
    await ensureAuthAndGoPlugins(page)

    for (let cycle = 0; cycle < 5; cycle++) {
        await open3NestedDialogs(page)

        for (const remainingDialogs of [2, 1, 0])
            await pressTopDialogEscape(page, remainingDialogs)

        await expectDialogsClosed(page)
        expect(page.url()).toContain('~/admin')
    }
})
