import { expect, Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const url = process.env.ADMIN_OPTIONS_URL || `http://localhost:${port}/~/admin/#/options/others`

test('directory cache status opens live counts and pending directories', async ({ page }) => {
    let status = { enabled: true, directories: 2, entries: 7, updating: ['/disk/photos'], networkPaths: ['/disk/photos'] }
    let refreshes = 0
    await page.route('**/~/api/get_directory_cache_status', route => route.fulfill({ json: status }))
    await page.route('**/~/api/refresh_directory_cache', route => {
        refreshes++
        status = { ...status, updating: ['/disk/videos'] }
        return route.fulfill({ json: {} })
    })
    await openOptions(page)
    const refresh = page.getByRole('button', { name: 'Refresh now', exact: true })
    await expect(refresh).toHaveCount(0)
    expect(refreshes).toBe(0)
    await expect(page.getByRole('link', { name: 'Periodic refresh is recommended', exact: true }))
        .toHaveAttribute('href', 'https://github.com/rejetto/hfs/wiki/Directory-cache')
    await expect(page.locator('a[href="https://github.com/rejetto/hfs/wiki/Directory-cache"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Updating', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('7 entries in 2 directories')
    await expect(dialog.getByRole('listitem')).toHaveText(['/disk/photos'])
    await page.screenshot({ path: '/tmp/hfs-directory-cache-status.png', animations: 'disabled' })
    status = { ...status, directories: 3, entries: 12, updating: [] }
    await expect(dialog).toContainText('12 entries in 3 directories')
    await expect(dialog.getByText('Ready', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible()
    await expect(refresh).toBeVisible()
    await expect(refresh).toHaveJSProperty('tagName', 'A')
    const readyBox = await page.getByRole('button', { name: 'Ready', exact: true }).boundingBox()
    const refreshBox = await refresh.boundingBox()
    expect(refreshBox!.y).toBe(readyBox!.y)
    await refresh.click()
    await page.getByRole('button', { name: 'Updating', exact: true }).click()
    await expect(dialog.getByRole('listitem')).toHaveText(['/disk/videos'])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(refresh).toHaveCount(0)
    expect(refreshes).toBe(1)
    status = { ...status, enabled: false, directories: 0, entries: 0, updating: [] }
    await expect(page.getByRole('button', { name: 'Updating', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Refresh now', exact: true })).toHaveCount(0)
})

test('cache polling lets slow requests finish in both the field and details', async ({ page }) => {
    let stall = false, pending = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/~/api/get_directory_cache_status', async route => {
        if (stall) {
            pending++
            await gate
        }
        await route.fulfill({ json: {
            enabled: true, directories: 1, entries: 2, networkPaths: [], updating: stall ? ['/disk/slow'] : [],
        } })
    })
    await openOptions(page)
    await page.getByRole('button', { name: 'Ready', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('2 entries in 1 directories')
    await page.clock.install()
    stall = true
    await page.clock.runFor(1000)
    await expect.poll(() => pending).toBe(2)
    await page.clock.runFor(3000)
    expect(pending).toBe(2)
    release()
    await expect(dialog.getByRole('listitem')).toHaveText(['/disk/slow'])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.clock.runFor(500)
    await expect(page.getByRole('button', { name: 'Updating', exact: true })).toBeVisible()
})

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
    await openOptions(page)
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

test('only mounts tables in the active tab', async ({ page }) => {
    await openOptions(page)
    const tables = page.locator('.MuiDataGrid-root')
    await tables.first().waitFor()
    expect(await tables.count()).toBe(2)
})

async function openOptions(page: Page) {
    await page.route('**/~/api/get_config', route => route.fulfill({ json: {
        port: 80, https_port: -1, descript_ion: true, directory_cache: -1,
        comments_storage: 'attr', descript_ion_encoding: 'utf8',
        server_code: '', mime: {}, block: [],
    } }))
    await page.route('**/~/api/get_status', route => route.fulfill({ json: {
        http: { listening: true, port: 80 }, https: {}, ips: [], connectionAddress: '127.0.0.1',
    } }))
    await page.route('**/~/api/get_admins', route => route.fulfill({ json: { list: [] } }))
    await page.goto(url)
}
