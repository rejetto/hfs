import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const original = 'port: 8080\n'

test.beforeEach(async ({ page }) => {
    await page.route('**/~/api/get_config_text', route => route.fulfill({ json: { text: original, fullPath: '/config.yaml' } }))
    await page.goto(process.env.ADMIN_CONFIG_URL || `http://localhost:${port}/~/admin/#/config`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.locator('main textarea')).toHaveValue(original)
})

test('reload discards edits when the saved config has not changed', async ({ page }) => {
    await page.locator('main textarea').fill('port: 9090\n')
    await page.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(page.locator('main textarea')).toHaveValue(original)
})

test('save completion preserves edits made while the request was pending', async ({ page }) => {
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    await page.route('**/~/api/set_config_text', async route => {
        await pending
        await route.fulfill({ json: {} })
    })
    const editor = page.locator('main textarea')
    await editor.fill('port: 9090\n')
    const request = page.waitForRequest('**/~/api/set_config_text')
    await page.getByRole('button', { name: /Save/ }).click()
    expect((await request).postDataJSON()).toEqual({ text: 'port: 9090\n' })
    await editor.fill('port: 9091\n')
    const response = page.waitForResponse('**/~/api/set_config_text')
    complete()
    await response
    await expect(page.getByRole('button', { name: /Save/ }).locator('.MuiCircularProgress-root')).toHaveCount(0)
    await expect(editor).toHaveValue('port: 9091\n')
})
