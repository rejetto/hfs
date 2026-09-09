import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port

test('renaming the current account keeps its Delete button disabled', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    let username = 'admin'
    await page.route('**/~/api/get_accounts', route => route.fulfill({ json: { list: [{
        username, hasPassword: true, isGroup: false, canLogin: true, adminActualAccess: true,
        canChangePassword: true, members: [], directMembers: [],
    }] } }))
    await page.route('**/~/api/get_account', route => {
        expect(route.request().postDataJSON().username).toBe('RenamedAdmin')
        return route.fulfill({ status: 404, json: {} })
    })
    await page.route('**/~/api/set_account', async route => {
        const request = route.request().postDataJSON()
        expect(request.username).toBe('admin')
        expect(request.changes.username).toBe('RenamedAdmin')
        username = 'renamedadmin'
        await route.fulfill({ json: { username } })
    })
    await page.goto(process.env.ADMIN_ACCOUNTS_URL || `http://localhost:${port}/~/admin/#/accounts`)
    await page.getByRole('treeitem', { name: 'admin', exact: true }).waitFor()
    await page.evaluate(() => { (window as any).state.username = 'admin' })
    await page.getByRole('treeitem', { name: 'admin', exact: true }).click()
    const deleteButton = page.getByRole('button', { name: /^(Delete|Cannot delete current account)$/ })
    await expect(deleteButton).toBeDisabled()
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('RenamedAdmin')
    await page.locator('button.saveBtn').click()
    await expect(page.getByRole('treeitem', { name: 'renamedadmin', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue('renamedadmin')
    await expect(deleteButton).toBeDisabled()
})
