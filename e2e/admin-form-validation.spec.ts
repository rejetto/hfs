import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_FORM_VALIDATION_URL, 'requires the Admin Vite server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/**', route => route.fulfill({ json: { setting: 'saved', username: 'admin', isAdmin: true } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/form-validation.ts'))}` }))
    await page.goto(process.env.ADMIN_FORM_VALIDATION_URL!)
})

for (const [value, error] of [['bad', 'Invalid name'], ['throw', 'Conversion failed']])
    test(`reset clears ${error} without remounting fields`, async ({ page }) => {
        const field = page.getByRole('textbox', { name: 'Name', exact: true })
        const node = await field.elementHandle()
        await field.fill('edited')
        await field.blur()
        await field.fill(value)
        await field.blur()
        await expect(page.getByText(error, { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Reset form', exact: true }).click()
        await expect(field).toHaveValue('saved')
        await expect(field).toHaveAttribute('aria-invalid', 'false')
        expect(await node!.evaluate(el => el.isConnected)).toBe(true)
        await field.fill('bad')
        await field.blur()
        await expect(page.getByText('Invalid name', { exact: true })).toBeVisible()
    })

for (const action of ['validate', 'submit'])
    test(`reset cancels ${action} and drops its late result`, async ({ page }) => {
        const field = page.getByRole('textbox', { name: 'Name', exact: true })
        if (action === 'validate') {
            await field.fill('bad')
            await field.blur()
            await expect(page.getByText('Invalid name', { exact: true })).toBeVisible()
        }
        await page.getByRole('button', { name: 'Hold validation', exact: true }).click()
        if (action === 'validate')
            await page.getByRole('button', { name: 'Validate', exact: true }).click()
        else
            await page.locator('form').first().locator('.saveBtn').click()
        await expect(page.getByTestId('pending')).toHaveText('true')
        await page.getByRole('button', { name: 'Reset form', exact: true }).click()
        if (action === 'validate')
            await expect(page.getByTestId('result')).toHaveText('false')
        await expect(field).toHaveValue('saved')
        await expect(field).toHaveAttribute('aria-invalid', 'false')
        await field.fill('bad')
        await field.blur()
        await expect(page.getByText('Invalid name', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Finish validation', exact: true }).click()
        await expect(page.getByTestId('pending')).toHaveText('false')
        await expect(page.getByText('Invalid name', { exact: true })).toBeVisible()
        await expect(page.getByText('Stale error', { exact: true })).toHaveCount(0)
        await expect(page.getByTestId('saves')).toHaveText('0')
        await field.fill('saved')
        await field.blur()
        await expect(field).toHaveAttribute('aria-invalid', 'false')
    })

test('ConfigForm Reset clears errors and restores saved values', async ({ page }) => {
    const field = page.getByRole('textbox', { name: 'Setting', exact: true })
    await field.fill('bad')
    await field.blur()
    await expect(page.getByText('Invalid setting', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(field).toHaveValue('saved')
    await expect(field).toHaveAttribute('aria-invalid', 'false')
})
