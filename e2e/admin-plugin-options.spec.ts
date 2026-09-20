import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_PLUGIN_OPTIONS_URL, 'requires the Admin Vite server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/**', route => {
        const cmd = new URL(route.request().url()).pathname.split('/').pop()
        if (cmd === 'get_plugin') return route.fulfill({ json: { config: { name: 'original', entries: [] } } })
        if (cmd === 'get_plugin_log') return route.fulfill({ contentType: 'text/event-stream', body: 'data: [["ready"]]\n\ndata:\n\n' })
        return route.fulfill({ json: { username: 'admin', isAdmin: true } })
    })
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/plugin-options.ts'))}` }))
})

test('new array entries honor defaults and skip null serialized function fields', async ({ page }) => {
    const url = new URL(process.env.ADMIN_PLUGIN_OPTIONS_URL!)
    await page.goto(String(url))
    await page.getByRole('button', { name: 'Open plugin options', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click()
    const entry = page.getByRole('dialog').last()
    await expect(entry.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('new entry')
    await expect(entry.getByRole('spinbutton', { name: 'Count', exact: true })).toHaveValue('7')
    await expect(entry.getByLabel('Omitted', { exact: true })).toHaveCount(0)
})

test('Save reports API failure and allows retry without losing edits', async ({ page }) => {
    let requests = 0
    await page.route('**/~/api/set_plugin', route => {
        requests++
        return requests === 1 ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fulfill({ json: {} })
    })
    await page.goto(process.env.ADMIN_PLUGIN_OPTIONS_URL!)
    await page.getByRole('button', { name: 'Open plugin options', exact: true }).click()
    const options = page.getByRole('dialog').first()
    await options.getByRole('textbox', { name: 'Name', exact: true }).fill('edited')
    await options.getByRole('textbox', { name: 'Name', exact: true }).blur()
    await options.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => requests).toBe(1)
    await expect(page.getByRole('dialog').last()).toContainText('Internal Server Error')
    await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).click()
    await expect(options.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('edited')
    await options.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => requests).toBe(2)
    await expect(page.getByRole('dialog').last()).toContainText('Configuration saved')
})
