import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const url = process.env.ADMIN_LOGS_URL || `http://localhost:${port}/~/admin/#/logs`

function logLine(uri: string, extra = '') {
    return `127.0.0.1 - josé [10/Sep/2026:12:00:00 +0200] "GET /${uri} HTTP/1.1" 200 1 ${extra}\n`
}

for (const whole of [false, true])
    test(whole ? 'loading the whole log retains both byte-range batches' : 'a complete Unicode log keeps its first record', async ({ page }) => {
        const bytes = Buffer.from(logLine('first.txt', whole ? JSON.stringify(JSON.stringify({ padding: 'x'.repeat(2 ** 20) })) : '') + logLine('recent.txt'))
        await page.route('**/~/api/get_log_info', route => route.fulfill({ json: { current: { log: bytes.length }, rotated: {} } }))
        await page.route(/\/~\/api\/get_log\?/, route => route.fulfill({ contentType: 'text/event-stream', body: 'data: [["ready"]]\n\ndata:\n\n' }))
        const ranges: string[] = []
        await page.route('**/~/api/get_log_file', route => {
            const range = route.request().postDataJSON().range as string
            ranges.push(range)
            const [from, to] = range.startsWith('-') ? [Math.max(0, bytes.length + Number(range)), bytes.length - 1] : range.split('-').map(Number)
            return route.fulfill({ status: 206, headers: { 'Content-Range': `bytes ${from}-${to}/${bytes.length}` }, body: bytes.subarray(from, to + 1) })
        })
        await page.goto(url)
        await expect(page.getByRole('gridcell').filter({ hasText: '/recent.txt' })).toBeVisible()
        if (whole) {
            const load = page.getByRole('button', { name: /Load whole log|Only 1/ })
            await load.click()
            await expect(load).toHaveCount(0)
        }
        expect(ranges).toHaveLength(whole ? 2 : 1)
        await expect(page.getByRole('gridcell').filter({ hasText: '/first.txt' })).toHaveCount(1)
        await expect(page.getByRole('gridcell').filter({ hasText: '/recent.txt' })).toHaveCount(1)
    })

test('reconnecting the live stream keeps previously loaded file history', async ({ page }) => {
    test.skip(!process.env.ADMIN_LOGS_URL, 'requires the Admin Vite server')
    await page.addInitScript(() => Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/**', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    const body = logLine('history.txt')
    const size = Buffer.byteLength(body)
    await page.route('**/~/api/get_log_info', route => route.fulfill({ json: { current: { log: size }, rotated: {} } }))
    await page.route('**/~/api/get_log_file', route => route.fulfill({ status: 206, headers: { 'Content-Range': `bytes 0-${size - 1}/${size}` }, body }))
    let connections = 0
    await page.route(/\/~\/api\/get_log\?/, route => {
        connections++
        return route.fulfill({ contentType: 'text/event-stream',
            // the first stream ends unexpectedly; the replacement sends the normal final empty message
            body: 'data: [["ready"]]\n\n' + (connections === 1 ? '' : 'data:\n\n') })
    })
    await page.goto(url)
    const history = page.getByRole('gridcell').filter({ hasText: '/history.txt' })
    await expect(history).toHaveCount(1)
    await expect.poll(() => connections).toBe(2)
    await expect(history).toHaveCount(1)
})
