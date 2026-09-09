import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_DATA_TABLE_URL, 'requires the Admin Vite server for the component fixture')
    await page.addInitScript(() => {
        Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } })
    })
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    // replace only the page fixture; DataTable, React, and the detail dialog run unchanged
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/data-table.ts'))}`,
    }))
})

// ADMIN_DATA_TABLE_URL=http://127.0.0.1:3112/#/monitoring uses the Admin Vite server
test('details refresh the selected row with custom identity', async ({ page }) => {
    await page.addInitScript(() => {
        Object.assign(window, { customTableId: true, showTableActions: true, hideTableExtra: true })
    })
    await page.goto(process.env.ADMIN_DATA_TABLE_URL!)
    await page.getByRole('gridcell', { name: 'second', exact: true }).click()
    const details = page.getByRole('dialog')
    await expect(details).toContainText('second: second details')
    await page.evaluate(() => window.updateTableRows())
    await expect(details).toContainText('second updated')
    await expect(details).not.toContainText('first updated')
})

test('merged details do not open a redundant dialog', async ({ page }) => {
    await page.addInitScript(() => {
        Object.assign(window, { showTableActions: true, hideTableExtra: true, mergeTableExtra: true })
    })
    await page.goto(process.env.ADMIN_DATA_TABLE_URL!)
    const cell = page.locator('[role="gridcell"][data-field="label"]').filter({ hasText: 'second' })
    await expect(cell).toContainText('second details')
    await cell.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
})
