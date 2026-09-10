import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const cases = [
    ...['/docs/'].map(root => ({ root, uri: '/docs/report.txt', expected: 'https://files.example/report.txt' })),
    { root: 'docs', uri: '/docs-old/report.txt', expected: undefined },
]
for (const { root, uri, expected } of cases)
    test(`file link follows domain root ${root} for ${uri}`, async ({ page }) => {
        test.skip(!process.env.ADMIN_FILE_FORM_URL, 'requires the Admin Vite server for the component fixture')
        await page.addInitScript(uri => Object.assign(window, {
            fileFormUri: uri, HFS: { session: { username: 'admin', isAdmin: true } },
        }), uri)
        await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
        await page.route('**/~/api/get_status', route => route.fulfill({ json: {
            baseUrl: 'https://files.example', urls: { http: ['https://files.example'] }, roots: { 'files.example': root, 'other.example': 'other/' },
        } }))
        await page.route('**/~/api/get_accounts', route => route.fulfill({ json: { list: [] } }))
        // replace the surrounding page only; FileForm and LinkField render unchanged
        await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
            body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/file-form.ts'))}` }))
        await page.goto(process.env.ADMIN_FILE_FORM_URL!)
        if (expected)
            await expect(page.locator('a[target="frontend"]')).toHaveAttribute('href', expected)
        else {
            await expect(page.getByRole('textbox', { name: 'Link', exact: true })).toHaveValue('outside of configured main address (files.example)')
            await expect(page.locator('a[target="frontend"]')).toHaveCount(0)
        }
    })
