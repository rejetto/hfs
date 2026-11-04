import { test, expect } from '@playwright/test'
import { posix, win32 } from 'node:path'

for (const scenario of [
    { start: '/', platform: 'linux' },
    { start: 'C:\\work', platform: 'win32' },
])
    test(`adding from disk remembers its folder ${scenario.start}`, async ({ page }) => {
        test.skip(!process.env.ADMIN_ADD_FILES_URL, 'requires the Admin Vite server')
        const { start, platform } = scenario
        const path = platform === 'win32' ? win32 : posix
        const serverCwd = platform === 'win32' ? 'C:\\server-cwd' : '/server-cwd'
        const directories = new Set([start, serverCwd, path.join(start, 'Report.tx')])
        await page.addInitScript(({ platform, separator }) => Object.assign(window, {
            HFS: { platform, pathSeparator: separator, session: { username: 'admin', isAdmin: true } },
        }), { platform, separator: path.sep })
        await page.route('**/~/api/**', route => {
            const cmd = new URL(route.request().url()).pathname.split('/').pop()
            if (cmd === 'get_vfs') return route.fulfill({ json: { root: { type: 'folder', source: start } } })
            if (cmd === 'get_status') return route.fulfill({ json: { platform, urls: { http: [] }, roots: {} } })
            if (cmd === 'get_accounts') return route.fulfill({ json: { list: [] } })
            if (cmd === 'refresh_session') return route.fulfill({ json: { username: 'admin', isAdmin: true } })
            if (cmd === 'resolve_path') {
                const args = route.request().postDataJSON()
                let resolved = path.resolve(serverCwd, args.path || '')
                // mirror resolve_path's closest existing directory behavior with an isolated filesystem fixture
                if (args.closestFolder)
                    while (!directories.has(resolved) && path.dirname(resolved) !== resolved)
                        resolved = path.dirname(resolved)
                return route.fulfill({ json: { path: resolved, isFolder: directories.has(resolved) } })
            }
            if (cmd === 'get_ls') return route.fulfill({ contentType: 'text/event-stream',
                body: 'data: ' + JSON.stringify([['+', { n: 'Report.txt', s: 1 }], ['ready']]) + '\n\ndata:\n\n' })
            return route.fulfill({ json: {} })
        })
        await page.goto(process.env.ADMIN_ADD_FILES_URL!)
        await expect(page.getByText('files from ' + start, { exact: true })).toBeVisible()
        await openPicker()
        const currentFolder = page.getByRole('dialog').getByRole('textbox', { name: 'Current folder', exact: true })
        await expect(currentFolder).toHaveValue(start)
        await page.getByRole('dialog').getByText('Report.txt', { exact: true }).click()
        // adding on compact screens selects the new VFS node and opens its form
        await expect.poll(() => page.evaluate(() => (window as any).state.vfs.children?.[0]?.name)).toBe('Report.txt')
        const detail = page.getByRole('dialog')
        if (await detail.count()) await detail.getByRole('button', { name: 'Close', exact: true }).click()
        await openPicker()
        await expect(currentFolder).toHaveValue(start)

        async function openPicker() {
            await page.getByRole('button', { name: 'Add item to virtual file system', exact: true }).first().click()
            await page.getByRole('menuitem', { name: 'file or folder from disk', exact: true }).click()
        }
    })
