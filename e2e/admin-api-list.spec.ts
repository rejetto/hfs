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
    await page.route('**/~/api/**', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.routeWebSocket(/\/~\/api\/get_log(?:\?|$)/, socket => {
        if (new URL(socket.url()).searchParams.get('file') === 'first')
            return socket.close({ code: 1012 })
        secondRequests++
        socket.send('[["+", {"name":"second"}], ["ready"]]')
        socket.close({ code: 1000 })
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
    let row = 1
    let interrupt!: () => void
    await page.route('**/~/api/**', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    await page.routeWebSocket(/\/~\/api\/get_log(?:\?|$)/, socket => {
        socket.send(JSON.stringify([['+', { name: `row-${row}` }], ['ready']]))
        if (row === 1) interrupt = () => socket.close({ code: 1012 })
        else socket.close({ code: 1000 })
    })
    const url = new URL(process.env.ADMIN_API_LIST_URL!)
    await page.goto(String(url))
    await expect(page.getByTestId('list')).toContainText('row-1')
    row++
    interrupt()
    await expect(page.getByTestId('list')).toContainText('row-2')
    await expect(page.getByTestId('list')).not.toContainText('row-1')
    row++
    await page.getByRole('button', { name: 'Reload stream', exact: true }).click()
    await expect(page.getByTestId('list')).toContainText('row-3')
    await expect(page.getByTestId('list')).not.toContainText('row-2')
    row++
    await page.getByRole('button', { name: 'Second stream', exact: true }).click()
    await expect(page.getByTestId('list')).toContainText('row-4')
    await expect(page.getByTestId('list')).not.toContainText('row-3')
})
