import { expect, test } from '@playwright/test'

test('cached plugins remain visible during refresh and reconcile without duplicates', async ({ page }) => {
    test.skip(!process.env.ADMIN_CATALOG_URL, 'requires the Admin Vite server')
    await page.addInitScript(() => {
        Object.assign(window, { HFS: { lang: { en: {} }, session: { username: 'admin', isAdmin: true } } })
        class Source {
            static all: Source[] = []
            OPEN = 1
            readyState = 1
            onmessage?: (event: { data: string }) => void
            constructor(public url: string) { Source.all.push(this) }
            close() { this.readyState = 2 }
        }
        Object.assign(window, { EventSource: Source, catalogSources: Source.all })
    })
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({
        contentType: 'text/javascript', body: 'export { default } from "/src/OnlinePlugins.ts"',
    }))
    await page.goto(`${process.env.ADMIN_CATALOG_URL}#/monitoring`)
    await expect(page.getByText('Plugin lists are cached for 5 minutes.', { exact: false })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).catalogSources.some((s: any) => s.url.includes('get_online_plugins')))).toBe(true)
    await message([
        ['+', { id: 'alice/one', repo: 'alice/one', version: 1, description: 'Cached plugin' }],
        ['+', { id: 'bob/two', repo: 'bob/two', version: 1, description: 'Removed plugin' }],
        ['props', { updatedAt: Date.now() - 6 * 60_000, refreshing: true }], ['ready'],
    ])
    await expect(page.getByText('Cached plugin', { exact: true })).toBeVisible()
    await expect(page.getByText('Updating…', { exact: false })).toBeVisible()
    await message([
        ['-', { id: 'bob/two' }],
        ['=', { id: 'alice/one' }, { version: 2, description: 'Fresh plugin' }],
        ['+', { id: 'carol/three', repo: 'carol/three', version: 1, description: 'New plugin' }],
        ['props', { updatedAt: Date.now(), refreshing: false }], ['ready'],
    ])
    await expect(page.getByText('Fresh plugin', { exact: true })).toBeVisible()
    await expect(page.getByText('New plugin', { exact: true })).toBeVisible()
    await expect(page.getByText('Removed plugin', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Updating…', { exact: false })).toHaveCount(0)
    await expect(page.locator('[role="row"][data-id]')).toHaveCount(2)
    await page.getByLabel('Search text').fill('carol')
    await expect.poll(() => page.evaluate(() => (window as any).catalogSources.at(-1).url)).toContain('carol')

    async function message(messages: unknown[]) {
        await page.evaluate(messages => {
            const source = (window as any).catalogSources.findLast((s: any) => s.url.includes('get_online_plugins'))
            source.onmessage({ data: JSON.stringify(messages) })
        }, messages)
    }
})
