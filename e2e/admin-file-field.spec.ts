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
