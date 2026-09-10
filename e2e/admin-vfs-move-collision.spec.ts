import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

for (const location of ['destination', 'selection'])
    test(`case collision in ${location}`, async ({ page }) => {
        test.skip(!process.env.ADMIN_VFS_MOVE_URL, 'requires the Admin Vite server for the component fixture')
        const names = ['Report.txt', 'report.txt']
        const fixture = { names: location === 'selection' ? names : names.slice(0, 1),
            destination: location === 'selection' ? [] : names.slice(1) }
        await page.addInitScript(({ platform, fixture }) => Object.assign(window, {
            moveFixture: fixture, HFS: { platform, session: { username: 'admin', isAdmin: true } },
        }), { platform: 'darwin', fixture })
        await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
        // only the surrounding page and bootstrap are fixtures; move validation, state and Undo run unchanged
        await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
            body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/vfs-move.ts'))}` }))
        await page.goto(process.env.ADMIN_VFS_MOVE_URL!)
        const tree = page.getByTestId('tree')
        await expect(tree).toContainText('from0')
        const paste = page.locator('button').filter({ has: page.getByTestId('ContentPasteIcon') })
        await expect(paste).toBeDisabled()
    })
