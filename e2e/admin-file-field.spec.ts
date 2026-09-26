import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const cases = [
    { name: 'POSIX sibling prefix', cwd: '/srv/hfs', from: '/srv/hfs-backup', expected: '/srv/hfs-backup/report.txt' },
    { name: 'Windows drive root', cwd: 'C:\\', from: 'C:\\', expected: 'report.txt' },
]

for (const { name, cwd, from, expected } of cases)
    test(`file picker preserves the selected path: ${name}`, async ({ page }) => {
        test.skip(!process.env.ADMIN_FILE_FIELD_URL, 'requires the Admin Vite server for the component fixture')
        await page.addInitScript(({ from, separator }) => {
            Object.assign(window, { pickerStart: from,
                HFS: { pathSeparator: separator, session: { username: 'admin', isAdmin: true } } })
        }, { from, separator: cwd.includes('\\') ? '\\' : '/' })
        await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
        await page.route('**/~/api/get_cwd', route => route.fulfill({ json: { path: cwd } }))
        await page.route('**/~/api/resolve_path', route => route.fulfill({ json: { path: from, isFolder: true } }))
        await page.route(/\/~\/api\/get_ls\?/, route => route.fulfill({
            contentType: 'text/event-stream',
            body: 'data: ' + JSON.stringify([['+', { n: 'report.txt', s: 20 }], ['ready']]) + '\n\ndata:\n\n',
        }))
        // exercise FileField and FilePicker unchanged; only the surrounding page and filesystem API are fixtures
        await page.route('**/src/MonitorPage.ts*', route => route.fulfill({
            contentType: 'text/javascript',
            body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/file-field.ts'))}`,
        }))
        await page.goto(process.env.ADMIN_FILE_FIELD_URL!)
        await page.getByRole('button', { name: 'Browse files...', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('textbox', { name: 'Current folder', exact: true })).toHaveValue(from)
        await dialog.getByText('report.txt', { exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue(expected)
    })

test('missing path is a non-blocking warning', async ({ page }) => {
    test.skip(!process.env.ADMIN_FILE_FIELD_URL, 'requires the Admin Vite server for the component fixture')
    await page.addInitScript(() => Object.assign(window, {
        pickerStart: '/', HFS: { pathSeparator: '/', session: { username: 'admin', isAdmin: true } },
    }))
    await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
    const calls: string[] = []
    let active = 0
    let maxActive = 0
    let releaseFirst!: () => void
    const firstPending = new Promise<void>(resolve => releaseFirst = resolve)
    await page.route('**/~/api/resolve_path', async route => {
        const { path } = route.request().postDataJSON()
        calls.push(path)
        maxActive = Math.max(maxActive, ++active)
        if (path === '/first') await firstPending
        await route.fulfill({ json: { path, isFolder: path === '/missing' ? undefined : false } })
        --active
    })
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/file-field.ts'))}` }))
    await page.goto(process.env.ADMIN_FILE_FIELD_URL!)

    const field = page.getByRole('textbox', { name: 'Path', exact: true })
    await field.fill('/m')
    await page.waitForTimeout(250)
    await field.fill('/mi')
    await page.waitForTimeout(250)
    await field.fill('/first')
    await page.waitForTimeout(700)
    expect(calls).toEqual([])
    await expect.poll(() => calls).toEqual(['/first'])
    await field.fill('/stale')
    await page.waitForTimeout(1200)
    await field.fill('/missing')
    await page.waitForTimeout(1200)
    expect(calls).toEqual(['/first'])
    releaseFirst()
    await expect(page.getByText('Path does not exist', { exact: true })).toBeVisible()
    await field.press('Enter')
    await field.blur()
    await expect(page.getByText('Path does not exist', { exact: true })).toBeVisible()
    await field.fill('/other')
    await page.waitForTimeout(250)
    await field.fill('/missing')
    await expect(page.getByText('Path does not exist', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Path does not exist', { exact: true })).toBeVisible()
    await expect(field).toHaveValue('/missing')
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    expect(calls).toEqual(['/first', '/missing', '/missing'])
    expect(maxActive).toBe(1)
})
