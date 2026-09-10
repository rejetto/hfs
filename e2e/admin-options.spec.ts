import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const url = process.env.ADMIN_OPTIONS_URL || `http://localhost:${port}/~/admin/#/options/others`

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
