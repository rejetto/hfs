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

test('Home in the selection disables cut and removal', async ({ page }) => {
    test.skip(!process.env.ADMIN_VFS_PAGE_URL, 'requires the Admin Vite server')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.addInitScript(() => Object.assign(window, { HFS: { pathSeparator: '/', session: { username: 'admin', isAdmin: true } } }))
    await page.route('**/~/api/**', route => {
        const cmd = new URL(route.request().url()).pathname.split('/').pop()
        if (cmd === 'get_vfs') return route.fulfill({ json: { root: { type: 'folder', children: [
            { name: 'first', type: 'folder' }, { name: 'second', type: 'folder' },
        ] } } })
        if (cmd === 'get_status') return route.fulfill({ json: { platform: 'linux', urls: { http: [] }, roots: {} } })
        if (cmd === 'get_accounts') return route.fulfill({ json: { list: [] } })
        if (cmd === 'refresh_session') return route.fulfill({ json: { username: 'admin', isAdmin: true } })
        return route.fulfill({ json: {} })
    })
    await page.goto(process.env.ADMIN_VFS_PAGE_URL!)
    await page.getByText('first', { exact: true }).click()
    await page.getByText('second', { exact: true }).click({ modifiers: ['ControlOrMeta'] })
    await page.getByText('Home folder', { exact: true }).click({ modifiers: ['ControlOrMeta'] })
    await expect.poll(() => page.evaluate(() => (window as any).state.selectedFiles.map((node: any) => node.id).sort()))
        .toEqual(['/', '/first/', '/second/'])
    await expect(page.locator('button:has([data-testid="ContentCutIcon"])')).toBeDisabled()
    await expect(page.locator('button:has([data-testid="DeleteIcon"])').first()).toBeDisabled()
    // the compact layout uses VfsPage's bulk action instead of the desktop toolbar
    await page.setViewportSize({ width: 500, height: 900 })
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
    await expect.poll(() => page.evaluate(() => ({
        isRoot: (window as any).state.vfs.isRoot,
        names: (window as any).state.vfs.children.map((node: any) => node.name),
    }))).toEqual({ isRoot: true, names: ['first', 'second'] })
})
