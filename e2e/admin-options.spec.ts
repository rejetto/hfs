import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const url = process.env.ADMIN_OPTIONS_URL || `http://localhost:${port}/~/admin/#/options/others`

test('proxy firewall reminder is shown only for a positive count', async ({ page }) => {
    await page.route('**/~/api/get_config', route => route.fulfill({ json: {
        port: 80, https_port: -1, proxies: 0, server_code: '', mime: {}, block: [],
    } }))
    await page.route('**/~/api/get_status', route => route.fulfill({ json: {
        http: { listening: true, port: 80 }, https: {}, ips: [], connectionAddress: '127.0.0.1',
    } }))
    await page.route('**/~/api/get_admins', route => route.fulfill({ json: { list: [] } }))
    await page.goto(url.replace('/others', '/net'))
    const count = page.getByRole('spinbutton', { name: 'Number of incoming HTTP proxies' })
    const reminder = page.getByText('Configure your firewall to allow only trusted proxies to connect to HFS.', { exact: true })
    await expect(count).toBeVisible()
    await expect(reminder).toHaveCount(0)
    await count.fill('1')
    await count.blur()
    await expect(reminder).toBeVisible()
    await count.fill('0')
    await count.blur()
    await expect(reminder).toHaveCount(0)
    await count.fill('')
    await count.blur()
    await expect(reminder).toHaveCount(0)
})

test('comment encoding follows storage mode despite the enabled legacy setting', async ({ page }) => {
    await page.route('**/~/api/get_config', route => route.fulfill({ json: {
        port: 80, https_port: -1, descript_ion: true,
        comments_storage: 'attr', descript_ion_encoding: 'utf8',
        server_code: '', mime: {}, block: [],
    } }))
    await page.route('**/~/api/get_status', route => route.fulfill({ json: {
        http: { listening: true, port: 80 }, https: {}, ips: [], connectionAddress: '127.0.0.1',
    } }))
    await page.route('**/~/api/get_admins', route => route.fulfill({ json: { list: [] } }))
    await page.goto(url)
    const encoding = page.getByRole('combobox', { name: /^Encoding of file DESCRIPT\.ION/ })
    const storage = page.getByRole('combobox', { name: /^Comments storage/ })
    await expect(encoding).toBeDisabled()
    for (const name of ['in file DESCRIPT.ION', 'in file attributes + load DESCRIPT.ION']) {
        await storage.click()
        await page.getByRole('option', { name, exact: true }).click()
        await expect(encoding).toBeEnabled()
    }
    await storage.click()
    await page.getByRole('option', { name: 'in file attributes', exact: true }).click()
    await expect(encoding).toBeDisabled()
})

for (const restored of ['', 'http://proxy.example:8080'])
    test(`reload clears validation errors when restoring ${restored || 'the original value'}`, async ({ page }) => {
        const config = { port: 80, https_port: -1, proxies: 0, outbound_proxy: '', server_code: '', mime: {}, block: [] }
        await page.route('**/~/api/get_config', route => route.fulfill({ json: config }))
        await page.route('**/~/api/get_status', route => route.fulfill({ json: {
            http: { listening: true, port: 80 }, https: {}, ips: [], connectionAddress: '127.0.0.1',
        } }))
        await page.route('**/~/api/get_admins', route => route.fulfill({ json: { list: [] } }))
        await page.goto(url.replace('/others', '/net'))
        const field = page.getByRole('textbox', { name: 'Outbound proxy', exact: true })
        await field.fill('invalid proxy')
        await field.blur()
        await expect(page.getByText('Invalid URL', { exact: true })).toBeVisible()
        config.outbound_proxy = restored
        await page.getByRole('button', { name: 'Reload', exact: true }).click()
        await expect(field).toHaveValue(restored)
        await expect(page.getByText('Invalid URL', { exact: true })).toHaveCount(0)
        await field.fill('still invalid')
        await field.blur()
        await expect(page.getByText('Invalid URL', { exact: true })).toBeVisible()
    })
