import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port

test('selecting another account in multiple groups avoids a self-deletion warning', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.addInitScript(username => {
        localStorage.setItem('admin_state', JSON.stringify({ accountsAsTree: true }))
        Object.assign(window, { HFS: { session: { username, isAdmin: true } } })
    }, 'admin')
    const member = { username: 'member', belongs: ['group-a', 'group-b'], hasPassword: true, isGroup: false,
        canLogin: true, canChangePassword: true, members: [], directMembers: [] }
    const list = ['group-a', 'group-b'].map(username => ({ username, isGroup: true, members: ['member'], directMembers: ['member'] }))
    await page.route('**/~/api/get_accounts', route => route.fulfill({ json: { list: [...list, member] } }))
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    const deleted: string[] = []
    await page.route('**/~/api/del_account', route => {
        deleted.push(route.request().postDataJSON().username)
        return route.fulfill({ json: {} })
    })
    await page.goto(process.env.ADMIN_ACCOUNTS_URL || `http://localhost:${port}/~/admin/#/accounts`)
    for (const group of ['group-a', 'group-b'])
        await page.getByRole('treeitem', { name: group, exact: true }).locator('.MuiTreeItem-iconContainer').click()
    await page.evaluate(username => { (window as any).state.username = username }, 'admin')
    const members = page.getByRole('treeitem', { name: 'member (group-a, group-b)', exact: true })
    await members.nth(0).click()
    await members.nth(1).click({ modifiers: ['ControlOrMeta'] })
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete 1 item(s)?')
    await expect(dialog).not.toContainText('account you are using')
    await dialog.getByRole('button', { name: 'Go', exact: true }).click()
    await expect.poll(() => deleted).toEqual(['member'])
})

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
