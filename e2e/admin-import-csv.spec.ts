import { test, expect, Page } from '@playwright/test'
import { resolve } from 'node:path'

async function openCsv(page: Page, csv = 'alice,password\nbob,') {
    test.skip(!process.env.ADMIN_CSV_URL, 'requires Admin Vite fixture server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/import-csv.ts'))}` }))
    await page.goto(process.env.ADMIN_CSV_URL!)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
    await (await chooser).setFiles({ name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByRole('dialog')).toContainText('Import accounts from CSV')
}

test('CSV import counts password failure and continues', async ({ page }) => {
    const added: string[] = []
    await page.route('**/~/api/add_account', route => {
        added.push(route.request().postDataJSON().username)
        return route.fulfill({ json: {} })
    })
    await page.route('**/~/api/change_srp', route => route.fulfill({ status: 500, json: {} }))
    await openCsv(page)
    await page.getByRole('dialog').getByRole('button', { name: 'ctrl + enter', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('1 failed, 1 succeeded')
    expect(added).toEqual(['alice', 'bob'])
})

test('CSV preview tolerates out-of-range skipped lines', async ({ page }) => {
    await openCsv(page)
    const input = page.getByRole('spinbutton', { name: 'Skip first lines', exact: true })
    await input.fill('5')
    await expect(page.getByRole('dialog')).toContainText('Import accounts from CSV')
    await expect(input).toHaveValue('5')
    await input.fill('0')
    await expect(page.getByRole('dialog')).toContainText('First username: alice')
})

test('CSV rejects fractional skipped lines', async ({ page }) => {
    await openCsv(page)
    await page.getByRole('spinbutton', { name: 'Skip first lines', exact: true }).fill('0.5')
    await page.getByRole('dialog').getByRole('button', { name: 'ctrl + enter', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Import accounts from CSV')
    await expect(page.getByRole('dialog')).toContainText('integer')
})
