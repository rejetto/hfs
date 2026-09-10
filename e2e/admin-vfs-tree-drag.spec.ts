import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'

for (const selected of ['other', 'multiple'])
    test(`dragging a folder with ${selected} selection moves the intended nodes`, async ({ page }) => {
        test.skip(!process.env.ADMIN_VFS_TREE_URL, 'requires Admin Vite fixture server')
        await page.addInitScript(() => Object.assign(window, {
            HFS: { platform: 'linux', session: { username: 'admin', isAdmin: true } },
        }))
        await page.route('**/~/api/refresh_session', route => route.fulfill({ json: { username: 'admin', isAdmin: true } }))
        await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
            body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/vfs-tree.ts'))}` }))
        await page.goto(process.env.ADMIN_VFS_TREE_URL!)
        const first = page.getByRole('treeitem', { name: 'first', exact: true })
        const second = page.getByRole('treeitem', { name: 'second', exact: true })
        await expect(second).toBeVisible()
        await first.click()
        if (selected === 'multiple') await second.click({ modifiers: ['ControlOrMeta'] })
        const output = page.getByTestId('tree-state')
        const original = await output.textContent()
        await second.locator('[draggable=true]').first().dragTo(
            page.getByRole('treeitem', { name: 'destination', exact: true }).locator('[draggable=true]').first())
        await expect(output).toHaveText(JSON.stringify(selected === 'multiple'
            ? [['destination', ['first', 'second']]]
            : [['first', []], ['destination', ['second']]]))
        await page.getByRole('button', { name: 'Undo fixture' }).click()
        await expect(output).toHaveText(original!)
    })
