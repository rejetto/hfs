import { test, expect } from '@playwright/test'
import { gotoFrontend } from './common'

test('file menu opens with synchronous plugin entries while asynchronous entries load', async ({ page }) => {
    await gotoFrontend(page)
    await page.getByRole('link', { name: 'cantListPage, Folder', exact: true }).click()
    await page.evaluate(() => {
        HFS.onEvent('fileMenu', () => ({ id: 'probe', label: 'Sync entry' }))
        HFS.onEvent('fileMenu', () => new Promise(resolve => {
            ;(window as any).resolveFastFileMenu = () =>
                resolve([{ id: 'probe', label: 'Fast replacement' }, { id: 'fast', label: 'Fast entry' }])
        }))
        HFS.onEvent('fileMenu', ({ props }) => new Promise(resolve => {
            ;(window as any).resolveSlowFileMenu = () => {
                props.push({ id: 'async-prop', label: 'Async property', value: 'Ready' })
                resolve([{ id: 'probe', label: 'Slow replacement' }, { id: 'slow', label: 'Slow entry' }])
            }
        }))
    })
    await page.getByRole('link', { name: 'alfa.txt', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'File menu', exact: true })).toBeVisible()
    await expect(page.locator('#menu-entry-download')).toBeVisible()
    await expect(page.locator('#menu-entry-probe')).toHaveText('Sync entry')
    await expect(page.locator('.file-menu-skeleton')).toBeVisible()
    await expect(page.locator('#menu-entry-fast')).toHaveCount(0)
    await expect(page.locator('#menu-entry-slow')).toHaveCount(0)
    await page.evaluate(() => (window as any).resolveFastFileMenu())
    await expect(page.locator('#menu-entry-probe')).toHaveText('Fast replacement')
    await expect(page.locator('#menu-entry-fast')).toHaveText('Fast entry')
    await expect(page.locator('#menu-entry-slow')).toHaveCount(0)
    await expect(page.locator('.file-menu-skeleton')).toBeVisible()
    await page.evaluate(() => (window as any).resolveSlowFileMenu())
    await expect(page.locator('#menu-entry-probe')).toHaveText('Slow replacement')
    await expect(page.locator('#menu-entry-slow')).toHaveText('Slow entry')
    await expect(page.locator('#menu-prop-async-prop')).toContainText('Ready')
    await expect(page.locator('.file-menu-skeleton')).toHaveCount(0)
})
