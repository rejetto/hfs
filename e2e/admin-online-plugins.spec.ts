import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const url = process.env.ADMIN_ONLINE_PLUGINS_URL || `http://localhost:${port}/~/admin/#/plugins/get`

test('show all plugin columns clears hidden columns and persists across reloads', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.route('**/~/api/**', route => {
        const cmd = route.request().url().split('/').pop()?.split('?')[0]
        const messages = cmd === 'get_online_plugins' ? [['+', { id: 'test-plugin', version: 1, description: 'Example', license: 'MIT', pushed_at: '2026-09-10', stargazers_count: 1 }], ['ready']] : []
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(messages) + '\n\ndata:\n\n' })
    })
    await page.goto(url)
    const name = page.locator('[role=columnheader][data-field=id]')
    const version = page.locator('[role=columnheader][data-field=version]')
    await expect(page.locator('[role=gridcell][data-field=id]').filter({ hasText: 'test-plugin' })).toBeVisible()
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    await expect(name).toBeVisible()
    await expect(version).toHaveCount(0)
    // use the header keyboard shortcut so autosizing cannot move the hover-only menu button
    await name.focus()
    await name.press('ControlOrMeta+Enter')
    await page.getByRole('menuitem', { name: 'Hide column', exact: true }).click()
    await expect(name).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('admin_state') || 'null')?.onlinePluginsColumns?.id)).toBe(false)
    await page.reload()
    await expect(page.locator('[role=columnheader][data-field=description]')).toBeVisible()
    await expect(name).toHaveCount(0)
    await expect(page.locator('[role=gridcell][data-field=description]').filter({ hasText: 'Example' })).toBeVisible()
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    const description = page.locator('[role=columnheader][data-field=description]')
    await description.focus()
    await description.press('ControlOrMeta+Enter')
    await page.getByRole('menuitem', { name: 'Manage columns', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Show/Hide All', exact: true }).click()
    await expect(version).toBeVisible()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('admin_state') || 'null')?.onlinePluginsColumns)).toEqual({})
    await page.reload()
    await expect(version).toBeVisible()
})
