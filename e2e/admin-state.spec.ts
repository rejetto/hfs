import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_STATE_URL, 'requires Admin Vite fixture server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/~/api/get_status', route => route.fulfill({ json: { roots: {}, urls: { http: [] } } }))
    await page.route('**/~/api/get_accounts', route => route.fulfill({ json: { list: [] } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/state.ts'))}` }))
    await page.goto(process.env.ADMIN_STATE_URL!)
})

test('cut item follows parent rename and undo', async ({ page }) => {
    await page.getByTestId('actions').getByRole('button', { name: 'Cut', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('renamed')
    await page.getByRole('textbox', { name: 'Name', exact: true }).blur()
    const output = page.getByTestId('state')
    await expect(output).toContainText('"folder":"/renamed/"')
    await expect(output).toContainText('"cut":["/renamed/file.txt"]')
    await page.getByRole('button', { name: 'Undo fixture', exact: true }).click()
    await expect(output).toContainText('"cut":["/docs/file.txt"]')
    const paste = page.getByTestId('actions').locator('button:has([data-testid="ContentPasteIcon"])')
    await expect(paste).toBeEnabled()
    await paste.click()
    await expect(output).toContainText('"destination":["file.txt"]')
})

test('partial reindex preserves cut items outside the renamed subtree', async ({ page }) => {
    const actions = page.getByTestId('multiple')
    await actions.getByRole('button', { name: 'Cut', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('renamed')
    await page.getByRole('textbox', { name: 'Name', exact: true }).blur()
    await expect(page.getByTestId('state')).toContainText('"cut":["/renamed/file.txt","/other/second.txt"]')
    await actions.locator('button:has([data-testid="ContentPasteIcon"])').click()
    await expect(page.getByTestId('state')).toContainText('"destination":["file.txt","second.txt"]')
})

test('renaming an expanded folder keeps its children visible', async ({ page }) => {
    const url = new URL(process.env.ADMIN_STATE_URL!)
    url.search = 'tree'
    await page.goto(String(url))
    const folder = page.getByRole('treeitem', { name: 'docs', exact: true })
    await folder.locator('.MuiTreeItem-iconContainer').click()
    await expect(page.getByRole('treeitem', { name: 'file.txt', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('renamed')
    await page.getByRole('textbox', { name: 'Name', exact: true }).blur()
    await expect(page.getByTestId('state')).toContainText('"folder":"/renamed/"')
    await expect(page.getByRole('treeitem', { name: 'file.txt', exact: true })).toBeVisible()
})
