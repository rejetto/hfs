import { expect, Page, test } from '@playwright/test'
import { URL, username, password } from './common'

async function selectVfsNode(page: Page, name: string, expectedId: string) {
    await page.getByRole('treeitem', { name, exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).state?.selectedFiles?.[0]?.id || ''))
        .toBe(expectedId)
}

async function pasteMovingNode(page: Page, movingName: string) {
    await page.getByRole('button', { name: new RegExp(movingName) }).click()
}

test('move via cut/paste keeps node visible', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('link', { name: 'Shared files' }).click()
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'zipNoList', '/zipNoList/')
    await page.getByRole('button', { name: 'Cut' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await selectVfsNode(page, 'f1', '/f1/')
    await pasteMovingNode(page, 'zipNoList')

    await expect.poll(() => page.evaluate(() => {
        function find(node: any, name: string): any {
            if (!node) return
            if (node.name === name) return node
            for (const child of node.children || []) {
                const found = find(child, name)
                if (found) return found
            }
        }
        const root = (window as any).state?.vfs
        const moved = find(root, 'zipNoList')
        const destination = find(root, 'f1')
        return {
            rootHasMoved: (root?.children || []).some((x: any) => x.name === 'zipNoList'),
            destinationHasMoved: (destination?.children || []).some((x: any) => x.name === 'zipNoList'),
            movedParent: moved?.parent?.id,
        }
    })).toEqual({
        rootHasMoved: false,
        destinationHasMoved: true,
        movedParent: '/f1/',
    })
})

test('move to nested destination expands ancestors', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('link', { name: 'Shared files' }).click()
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'zipNoList', '/zipNoList/')
    await page.getByRole('button', { name: 'Cut' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('treeitem', { name: 'protectFromAbove', exact: true }).dblclick()
    await selectVfsNode(page, 'child', '/protectFromAbove/child/')
    await pasteMovingNode(page, 'zipNoList')

    await expect.poll(() => page.evaluate(() => {
        function find(node: any, name: string): any {
            if (!node) return
            if (node.name === name) return node
            for (const child of node.children || []) {
                const found = find(child, name)
                if (found) return found
            }
        }
        const root = (window as any).state?.vfs
        const moved = find(root, 'zipNoList')
        const destination = find(root, 'child')
        const expanded = (window as any).state?.expanded || []
        return {
            destinationHasMoved: (destination?.children || []).some((x: any) => x.name === 'zipNoList'),
            movedParent: moved?.parent?.id,
            hasDestinationExpanded: expanded.includes('/protectFromAbove/child/'),
            hasAncestorExpanded: expanded.includes('/protectFromAbove/'),
        }
    })).toEqual({
        destinationHasMoved: true,
        movedParent: '/protectFromAbove/child/',
        hasDestinationExpanded: true,
        hasAncestorExpanded: true,
    })
})

test('move into empty folder keeps node visible', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('link', { name: 'Shared files' }).click()
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'zipNoList', '/zipNoList/')
    await page.getByRole('button', { name: 'Cut' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await selectVfsNode(page, 'for-disabled', '/for-disabled/')
    await pasteMovingNode(page, 'zipNoList')

    await expect.poll(() => page.evaluate(() => {
        function find(node: any, name: string): any {
            if (!node) return
            if (node.name === name) return node
            for (const child of node.children || []) {
                const found = find(child, name)
                if (found) return found
            }
        }
        const root = (window as any).state?.vfs
        const moved = find(root, 'zipNoList')
        const destination = find(root, 'for-disabled')
        return {
            rootHasMoved: (root?.children || []).some((x: any) => x.name === 'zipNoList'),
            destinationHasMoved: (destination?.children || []).some((x: any) => x.name === 'zipNoList'),
            movedParent: moved?.parent?.id,
        }
    })).toEqual({
        rootHasMoved: false,
        destinationHasMoved: true,
        movedParent: '/for-disabled/',
    })
})

test('delete virtual folder updates tree and marks modified', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('link', { name: 'Shared files' }).click()
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    const folderName = 'for-disabled'
    await selectVfsNode(page, folderName, '/for-disabled/')
    await page.getByRole('button', { name: 'Delete' }).first().click()
    const confirm = page.locator('.dialog-confirm')
    await expect(confirm).toBeVisible()
    await confirm.locator('a').first().click()

    await expect.poll(() => page.evaluate(name => {
        const root = (window as any).state?.vfs
        return {
            hasFolder: (root?.children || []).some((x: any) => x.name === name),
            modified: (window as any).state?.vfsModified,
        }
    }, folderName)).toEqual({
        hasFolder: false,
        modified: true,
    })
})

test('undo toggles with single-level redo behavior', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('link', { name: 'Shared files' }).click()
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    const folderName = 'for-disabled'
    const undoButton = page.locator('svg[data-testid="UndoIcon"]').first().locator('xpath=ancestor::button[1]')
    await expect(undoButton).toBeDisabled()

    await selectVfsNode(page, folderName, '/for-disabled/')
    await page.getByRole('button', { name: 'Delete' }).first().click()
    const confirm = page.locator('.dialog-confirm')
    await expect(confirm).toBeVisible()
    await confirm.locator('a').first().click()
    await expect(undoButton).toBeEnabled()

    await expect.poll(() => page.evaluate(name => {
        const root = (window as any).state?.vfs
        return {
            hasFolder: (root?.children || []).some((x: any) => x.name === name),
            modified: (window as any).state?.vfsModified,
        }
    }, folderName)).toEqual({
        hasFolder: false,
        modified: true,
    })

    await undoButton.click()
    await expect.poll(() => page.evaluate(name => {
        const root = (window as any).state?.vfs
        return {
            hasFolder: (root?.children || []).some((x: any) => x.name === name),
            modified: (window as any).state?.vfsModified,
        }
    }, folderName)).toEqual({
        hasFolder: true,
        modified: true,
    })

    await undoButton.click()
    await expect.poll(() => page.evaluate(name => {
        const root = (window as any).state?.vfs
        return {
            hasFolder: (root?.children || []).some((x: any) => x.name === name),
            modified: (window as any).state?.vfsModified,
        }
    }, folderName)).toEqual({
        hasFolder: false,
        modified: true,
    })
})

test('apply keeps unset permissions nullish in-memory', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('link', { name: 'Shared files' }).click()
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'f1', '/f1/')
    await page.locator('button:has-text("Apply")').click()

    await expect.poll(() => page.evaluate(() => {
        const node = (window as any).state?.selectedFiles?.[0]
        const unsetPerms = ['can_see', 'can_read', 'can_list', 'can_upload', 'can_delete', 'can_archive']
            .filter(k => node?.[k] == null)
        return { id: node?.id, unsetPerms }
    })).toEqual({
        id: '/f1/',
        unsetPerms: ['can_see', 'can_read', 'can_list', 'can_upload', 'can_delete', 'can_archive'],
    })
})
