import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test('editing selected accounts preserves separate children permission', async ({ page }) => {
    test.skip(!process.env.ADMIN_WHO_FIELD_URL, 'requires Admin Vite fixture server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/~/api/get_accounts', route => route.fulfill({ json: { list: [{ username: 'alice' }, { username: 'bob' }] } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/who-field.ts'))}` }))
    const url = new URL(process.env.ADMIN_WHO_FIELD_URL!)
    await page.goto(String(url))
    const accounts = page.getByRole('combobox').filter({ has: page.locator('[aria-label="Accounts Download: alice"]') })
    await accounts.click()
    await page.getByRole('option', { name: 'bob', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('permission')).toHaveText(JSON.stringify({ this: ['alice', 'bob'], children: false }))
    await expect(page.getByRole('combobox', { name: 'Permission for folder content' })).toHaveText('No one')
})
