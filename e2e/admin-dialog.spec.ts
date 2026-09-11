import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_DIALOG_URL, 'requires the Admin Vite server')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/**', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/dialog.ts'))}` }))
    await page.goto(process.env.ADMIN_DIALOG_URL!)
})

test('dialog bar follows manual theme changes without crashing', async ({ page }) => {
    const bar = page.getByTestId('bar')
    await expect(bar).toBeVisible()
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click()
    await expect(bar).toBeVisible()
    await page.getByRole('button', { name: 'Light theme', exact: true }).click()
    await expect(bar).toBeVisible()
})

test('failed alternate save does not change the next Save and close action', async ({ page }) => {
    await page.getByRole('button', { name: 'Open form', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Save without closing', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('valid')
    // isolate alternate-submit behavior from Form's separate commit-on-blur validation timing
    await dialog.getByRole('textbox', { name: 'Name' }).blur()
    await expect(page.getByTestId('validated')).toHaveText('valid')
    await dialog.getByRole('button').filter({ hasText: 'Save and close' }).click()
    await expect(dialog).toHaveCount(0)
})
