import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_API_LIST_URL, 'requires the Admin Vite server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/api-list.ts'))}` }))
})

test('a failed connection is shown and its retry cannot reload a different stream', async ({ page }) => {
    let secondRequests = 0
    await page.route('**/~/api/**', route => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith('/get_log')) {
            if (url.searchParams.get('file') === 'first') return route.abort()
            secondRequests++
            return route.fulfill({ contentType: 'text/event-stream',
                body: 'data: [["+", {"name":"second"}], ["ready"]]\n\ndata:\n\n' })
        }
        return route.fulfill({ json: { username: 'admin', isAdmin: true } })
    })
    await page.goto(process.env.ADMIN_API_LIST_URL!)
    await expect(page.getByTestId('error')).toHaveText('Connection error')
    await expect(page.getByTestId('element')).toContainText('Connection error')
    await page.getByRole('button', { name: 'Second stream' }).click()
    await expect(page.getByTestId('list')).toContainText('second')
    // exceed the hook's one-second retry deadline before checking for a stale request
    await page.waitForTimeout(1500)
    expect(secondRequests).toBe(1)
})

test('reconnection replaces a snapshot and explicit changes reset it', async ({ page }) => {
    let requests = 0
    await page.route('**/~/api/**', route => {
        const url = new URL(route.request().url())
        if (!url.pathname.endsWith('/get_log'))
            return route.fulfill({ json: { username: 'admin', isAdmin: true } })
        requests++
        return route.fulfill({ contentType: 'text/event-stream',
            body: 'data: ' + JSON.stringify([['+', { name: `row-${requests}` }], ['ready']])
                + '\n\n' + (requests === 1 ? '' : 'data:\n\n') })
    })
    const url = new URL(process.env.ADMIN_API_LIST_URL!)
    await page.goto(String(url))
    await expect(page.getByTestId('list')).toContainText('row-1')
    await expect(page.getByTestId('list')).toContainText('row-2')
    await expect(page.getByTestId('list')).not.toContainText('row-1')
    await page.getByRole('button', { name: 'Reload stream', exact: true }).click()
    await expect(page.getByTestId('list')).toContainText('row-3')
    await expect(page.getByTestId('list')).not.toContainText('row-2')
    await page.getByRole('button', { name: 'Second stream', exact: true }).click()
    await expect(page.getByTestId('list')).toContainText('row-4')
    await expect(page.getByTestId('list')).not.toContainText('row-3')
})
