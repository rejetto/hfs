import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_DATE_TIME_URL, 'requires the Admin Vite server for the component fixture')
    await page.addInitScript(() => { Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }) })
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/date-time.ts'))}` }))
    await page.goto(process.env.ADMIN_DATE_TIME_URL!)
})

test('invalid dates cannot be submitted as an empty date', async ({ page }) => {
    const day = page.getByRole('spinbutton', { name: 'Day', exact: true })
    await day.click()
    await day.press('3')
    await day.press('1')
    await page.locator('button.saveBtn').click()
    await expect.poll(() => page.evaluate(() => ({ saved: window.savedDate, error: window.dateError }))).toEqual({ error: 'Please review errors' })
    await page.getByRole('button', { name: /Choose date/ }).click()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await page.locator('button.saveBtn').click()
    await expect.poll(() => page.evaluate(() => JSON.parse(window.savedDate || '{}').when)).toMatch(/^\d{4}-/)
    await page.getByRole('button', { name: /Choose date/ }).click()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.locator('button.saveBtn').click()
    await expect.poll(() => page.evaluate(() => window.savedDate)).toBe('{"when":null}')
})
