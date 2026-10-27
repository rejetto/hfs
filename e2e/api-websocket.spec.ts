import { expect, test, WebSocketRoute } from '@playwright/test'
import { gotoFrontend } from './common'

test('eight notification subscriptions leave HTTP requests usable', async ({ page }) => {
    await gotoFrontend(page)
    await page.waitForFunction(() => typeof HFS.getNotifications === 'function')
    const channels: string[] = []
    page.on('websocket', socket => {
        if (socket.url().includes('get_notifications')) channels.push(socket.url())
    })
    const count = await page.evaluate(async () => {
        const sources = await Promise.all(Array.from({ length: 8 }, (_, i) => HFS.getNotifications('ws-test-' + i, () => {})))
        const response = await fetch('/~/api/get_file_list')
        const { list } = await response.json()
        for (const source of sources) source.close()
        return list.length
    })
    expect(channels).toHaveLength(8)
    expect(count).toBeGreaterThan(0)
})

test('notification abstractions reconnect after interruption and stop after explicit close', async ({ page }) => {
    const routes: WebSocketRoute[] = []
    await page.routeWebSocket(/get_notifications/, route => {
        routes.push(route)
        route.send(JSON.stringify([['probe', routes.length]]))
    })
    await gotoFrontend(page)
    await page.waitForFunction(() => typeof HFS.getNotifications === 'function')
    await page.evaluate(async () => {
        Object.assign(window, { received: [] })
        const source = await HFS.getNotifications('reconnect-probe', (_name: string, data: unknown) => (window as any).received.push(data))
        Object.assign(window, { notificationSource: source })
    })
    await expect.poll(() => page.evaluate(() => (window as any).received)).toEqual([1])
    routes[0].close({ code: 1012 })
    await expect.poll(() => page.evaluate(() => (window as any).received)).toEqual([1, 2])
    await page.evaluate(() => (window as any).notificationSource.close())
    await page.waitForTimeout(1200)
    expect(routes).toHaveLength(2)
})
