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

test('progress tooltip derives ETA from remaining request bytes', async ({ page }) => {
    await openMonitoring(page, [
        { path: '/full.bin', op: 'download', opProgress: .25, opTotal: 1_000_000, opRemaining: 750_000, outSpeedKb: 500, inSpeedKb: 50_000 },
        { path: '/range.bin', op: 'download', opProgress: 0, opTotal: 1_000_000_000, opRemaining: 1_500, outSpeedKb: 1 },
        { path: '/upload.bin', op: 'upload', opProgress: .25, opTotal: 1_000_000, opRemaining: 750_000, outSpeedKb: 50_000, inSpeedKb: 500 },
        { path: '/stalled.bin', op: 'download', opProgress: .25, opTotal: 1_000_000, opRemaining: 750_000, outSpeedKb: 0, inSpeedKb: 500 },
    ])

    expect(await tooltipFor('full.bin')).toContain('ETA: 1s')
    expect(await tooltipFor('range.bin')).toContain('ETA: 1s')
    expect(await tooltipFor('upload.bin')).toContain('ETA: 1s')
    expect(await tooltipFor('stalled.bin')).not.toContain('ETA:')

    async function tooltipFor(file: string) {
        const cell = page.locator('[role=gridcell][data-field=path]', { hasText: file }).first()
        await cell.locator('.MuiCircularProgress-root').last().hover()
        const tooltip = page.getByRole('tooltip').last()
        await expect(tooltip).toBeVisible()
        const text = await tooltip.innerText()
        await page.mouse.move(0, 0)
        await expect(tooltip).toBeHidden()
        return text
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
