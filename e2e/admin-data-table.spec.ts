import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

// ADMIN_DATA_TABLE_URL=http://127.0.0.1:3112/#/monitoring uses the Admin Vite server
test('details refresh the selected row with custom identity', async ({ page }) => {
    test.skip(!process.env.ADMIN_DATA_TABLE_URL, 'requires the Admin Vite server for the component fixture')
    await page.addInitScript(() => {
        Object.assign(window, { customTableId: true, HFS: { session: { username: 'admin', isAdmin: true } } })
    })
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    // replace only the page fixture; DataTable, React, and the detail dialog run unchanged
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/data-table.ts'))}`,
    }))
    await page.goto(process.env.ADMIN_DATA_TABLE_URL!)
    await page.getByRole('gridcell', { name: 'second', exact: true }).click()
    const details = page.getByRole('dialog')
    await expect(details).toContainText('second: second details')
    await page.evaluate(() => window.updateTableRows())
    await expect(details).toContainText('second updated')
    await expect(details).not.toContainText('first updated')
})
