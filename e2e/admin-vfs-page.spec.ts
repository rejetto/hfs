import { test, expect } from '@playwright/test'

for (const mode of ['empty', 'error'])
    test(`disk content completes with ${mode}`, async ({ page }) => {
        test.skip(!process.env.ADMIN_VFS_PAGE_URL, 'requires the Admin Vite server')
        await page.addInitScript(() => Object.assign(window, { HFS: { pathSeparator: '/', session: { username: 'admin', isAdmin: true } } }))
        await page.route('**/~/api/**', route => {
            const cmd = new URL(route.request().url()).pathname.split('/').pop()
            if (cmd === 'get_vfs') return route.fulfill({ json: { root: { type: 'folder', source: '/fixture' } } })
            if (cmd === 'get_status') return route.fulfill({ json: { platform: 'linux', urls: { http: [] }, roots: {} } })
            if (cmd === 'get_accounts') return route.fulfill({ json: { list: [] } })
            if (cmd === 'refresh_session') return route.fulfill({ json: { username: 'admin', isAdmin: true } })
            if (cmd === 'get_ls') return route.fulfill({ contentType: 'text/event-stream',
                body: 'data: ' + JSON.stringify(mode === 'error' ? [['e', 'fixture list error']]
                    : [['ready']]) + '\n\ndata:\n\n' })
            return route.fulfill({ json: {} })
        })
        await page.goto(process.env.ADMIN_VFS_PAGE_URL!)
        await page.getByText('files from /fixture', { exact: true }).click()
        if (mode === 'error')
            await expect(page.getByRole('alert').filter({ hasText: 'fixture list error' })).toBeVisible()
        else {
            await expect(page.getByText('From /fixture', { exact: true })).toBeVisible()
        }
        await expect(page.getByRole('progressbar')).toHaveCount(0)
    })
