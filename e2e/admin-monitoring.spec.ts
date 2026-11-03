import { expect, Page, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    test.skip(!process.env.ADMIN_MONITORING_URL, 'requires the Admin Vite server')
    await page.route('**/~/api/**', route => {
        const cmd = new URL(route.request().url()).pathname.split('/').pop()
        const count = route.request().postDataJSON()?.ips?.length || 0
        return route.fulfill({ json: cmd === 'ip_country' ? { codes: Array(count).fill('') }
            : cmd === 'is_ip_blocked' ? { blocked: Array(count).fill(false) }
                : { username: 'admin', isAdmin: true } })
    })
})

test('hidden Sent merges under Speed and stays right aligned', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openMonitoring(page, [
        { path: '/idle.bin', op: 'download', sent: 751 },
        { path: '/active.bin', op: 'download', sent: 1200, outSpeedKb: 100 },
    ])

    await expect(page.locator('[role=gridcell][data-field=sent]')).toHaveCount(0)
    await expect(speedCell('idle.bin')).toHaveText('-751 B')
    const alignment = await speedCell('active.bin').evaluate(cell => {
        const merged = cell.firstElementChild!.lastElementChild!
        const sent = merged.lastElementChild!
        return {
            marginLeft: parseFloat(getComputedStyle(sent).marginLeft),
            rightDelta: merged.getBoundingClientRect().right - sent.getBoundingClientRect().right,
        }
    })
    expect(alignment.marginLeft).toBeGreaterThan(0)
    expect(Math.abs(alignment.rightDelta)).toBeLessThan(.5)

    function speedCell(file: string) {
        return page.locator('[role=row]', { hasText: file }).locator('[role=gridcell][data-field=outSpeedKb]').first()
    }
})

async function openMonitoring(page: Page, rows: Record<string, unknown>[]) {
    await page.routeWebSocket('**/~/api/**', socket => {
        const cmd = new URL(socket.url()).pathname.split('/').pop()
        const connections = cmd === 'get_connections'
            ? rows.map((row, i) => ({ ip: '127.0.0.2', port: 2000 + i, v: 4, ...row }))
            : []
        socket.send(JSON.stringify([...connections.map(row => ['+', row]), ['ready']]))
        socket.close({ code: 1000 })
    })
    await page.goto(process.env.ADMIN_MONITORING_URL!)
}
