import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

declare global {
    interface Window {
        sources: { url: string, onopen?: () => void, onerror?: () => void,
            onmessage?: (event: { data: string }) => void }[]
    }
}

test('list retries preserve complete snapshots only within their window', async ({ page }) => {
    test.skip(!process.env.ADMIN_LIST_URL, 'requires the Admin Vite server')
    await page.addInitScript(() => {
        Object.assign(window, { HFS: { lang: { en: {} }, session: { username: 'admin', isAdmin: true } } })
        class Source {
            static all: Source[] = []
            OPEN = 1
            CLOSED = 2
            readyState = 1
            onopen?: () => void
            onerror?: () => void
            onmessage?: (event: { data: string }) => void
            constructor(public url: string) { Source.all.push(this) }
            close() { this.readyState = this.CLOSED }
        }
        Object.assign(window, { EventSource: Source, sources: Source.all })
    })
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/list-reconnect.ts'))}`,
    }))
    for (const [cmd, file, windowMs] of [
        ['get_plugins', '', 60_000], ['get_online_plugins', '', 60_000],
        ['get_plugin_updates', '', 60_000], ['get_plugin_log', '', 5000],
        ['get_log', 'console', 1000], ['get_log', 'disconnections', 1000], ['get_log', 'ips', 60_000],
        ['custom_list', '', 5000], ['get_connections', '', 0], ['get_ls', '', 0], ['get_langs', '', 0], ['get_file_list', '', 0],
    ] as const) {
        await page.goto(`${process.env.ADMIN_LIST_URL}?cmd=${cmd}&file=${file}${windowMs ? '&window=' + windowMs / 1000 : ''}#/monitoring`)
        await expect(page.getByTestId('list')).toHaveText('[]')
        await page.clock.install()
        await message([['+', { id: 'saved' }], ['ready']])
        await expect(page.getByTestId('list')).toContainText('saved')
        await disconnect()
        await page.clock.runFor(windowMs === 1000 ? 500 : 1000)
        expect(await skipInitial(), cmd).toBe(windowMs ? 'true' : null)
        await expect(page.getByTestId('list')).toHaveText(windowMs ? '[{"id":"saved"}]' : '[]')
        if (!windowMs) continue
        // repeated failures cannot restart the timeout
        await disconnect()
        await page.clock.runFor(windowMs + 1000)
        await disconnect()
        await page.clock.runFor(1000)
        expect(await skipInitial()).toBeNull()
        await expect(page.getByTestId('list')).toHaveText('[]')
        // an incomplete snapshot must be fetched again
        await message([['+', { id: 'partial' }]])
        await disconnect()
        await page.clock.runFor(1000)
        expect(await skipInitial()).toBeNull()
        // explicit reload also discards a completed snapshot
        await message([['+', { id: 'fresh' }], ['ready']])
        await page.getByRole('button', { name: 'Reload fixture' }).click()
        expect(await skipInitial()).toBeNull()
        await expect(page.getByTestId('list')).toHaveText('[]')
        // a handshake completed after expiry must fall back to a full snapshot
        await message([['+', { id: 'slow' }], ['ready']])
        await disconnect()
        await page.clock.runFor(windowMs === 1000 ? 500 : 1000)
        expect(await skipInitial()).toBe('true')
        await page.clock.runFor(windowMs)
        await page.evaluate(() => window.sources.at(-1)!.onopen?.())
        expect(await skipInitial()).toBeNull()
        await expect(page.getByTestId('list')).toHaveText('[]')
    }

    // infinite retention keeps history even before ready, but only ready allows skipping the snapshot
    await page.goto(`${process.env.ADMIN_LIST_URL}?cmd=get_log&file=log&window=Infinity#/monitoring`)
    await expect(page.getByTestId('list')).toHaveText('[]')
    await page.clock.install()
    await message([['+', { id: 'history' }]])
    await disconnect()
    await page.clock.runFor(120_000)
    expect(await skipInitial()).toBeNull()
    await expect(page.getByTestId('list')).toHaveText('[{"id":"history"}]')
    await message([['ready']])
    await disconnect()
    await page.clock.runFor(120_000)
    expect(await skipInitial()).toBe('true')
    await expect(page.getByTestId('list')).toHaveText('[{"id":"history"}]')
    await page.getByRole('button', { name: 'Reload fixture' }).click()
    expect(await skipInitial()).toBeNull()
    await expect(page.getByTestId('list')).toHaveText('[]')

    async function message(data: unknown[]) {
        await page.evaluate(data => {
            const source = window.sources.at(-1)!
            source.onopen?.()
            source.onmessage?.({ data: JSON.stringify(data) })
        }, data)
    }
    async function disconnect() {
        await page.evaluate(() => window.sources.at(-1)!.onerror?.())
    }
    async function skipInitial() {
        return page.evaluate(() => new URL(window.sources.at(-1)!.url, location.href).searchParams.get('skipInitial'))
    }
})
