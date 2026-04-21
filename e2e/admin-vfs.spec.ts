import { expect, Page, test } from '@playwright/test'
import { clickAdminMenu, URL, username, password, clickIconBtn } from './common'

async function selectVfsNode(page: Page, name: string, expectedId: string) {
    await page.getByRole('treeitem', { name, exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).state?.selectedFiles?.[0]?.id || ''))
        .toBe(expectedId)
}

async function pasteMovingNode(page: Page, movingName: string) {
    await clickIconBtn(new RegExp(movingName), page)
}

async function expandVfsNode(page: Page, nodeId: string) {
    // Mobile uses a details dialog for selection, so forcing expansion via app state keeps this test focused on move behavior.
    await expect.poll(() => page.evaluate(id => {
        const state = (window as any).state
        if (!state) return false
        if (!state.expanded.includes(id))
            state.expanded = [...state.expanded, id]
        return state.expanded.includes(id)
    }, nodeId)).toBe(true)
}

test('move via cut/paste keeps node visible', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'zipNoList', '/zipNoList/')
    await clickIconBtn('Cut', page)
    await clickIconBtn('Close', page)
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
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'zipNoList', '/zipNoList/')
    await clickIconBtn('Cut', page)
    await clickIconBtn('Close', page)
    await expandVfsNode(page, '/protectFromAbove/')
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
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'zipNoList', '/zipNoList/')
    await clickIconBtn('Cut', page)
    await clickIconBtn('Close', page)
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
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    const folderName = 'for-disabled'
    await selectVfsNode(page, folderName, '/for-disabled/')
    await clickIconBtn('Delete', page)

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
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    const folderName = 'for-disabled'
    const undoButton = page.locator('svg[data-testid="UndoIcon"]').first().locator('xpath=ancestor::button[1]')
    await expect(undoButton).toBeDisabled()

    await selectVfsNode(page, folderName, '/for-disabled/')
    await clickIconBtn('Delete', page)
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
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await selectVfsNode(page, 'f1', '/f1/')
    await page.locator('button:has-text("Apply")').click()

    await expect.poll(() => page.evaluate(() => {
        function findById(node: any, id: string): any {
            if (!node) return
            if (node.id === id) return node
            for (const child of node.children || []) {
                const found = findById(child, id)
                if (found) return found
            }
        }
        // On mobile, applying from the details dialog can clear selectedFiles on dialog close; assert against canonical VFS node instead.
        const node = findById((window as any).state?.vfs, '/f1/')
        const unsetPerms = ['can_see', 'can_read', 'can_list', 'can_upload', 'can_delete', 'can_archive']
            .filter(k => node?.[k] == null)
        return { id: node?.id, unsetPerms }
    })).toEqual({
        id: '/f1/',
        unsetPerms: ['can_see', 'can_read', 'can_list', 'can_upload', 'can_delete', 'can_archive'],
    })
})

test('apply refreshes inherited permissions for descendants in-memory', async ({ page }) => {
    await page.goto(URL + '~/admin/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await clickAdminMenu(page, /Shared files/)
    await page.getByText('zipNoList', { exact: true }).waitFor({ timeout: 10_000 })

    await expect.poll(() => page.evaluate(() => {
        const state = (window as any).state
        if (!state?.vfs) return ''
        state.selectedFiles = [state.vfs]
        return state.selectedFiles[0]?.id || ''
    })).toBe('/')
    await page.getByRole('combobox', { name: 'Who can download' }).click()
    await page.getByRole('option', { name: 'No one' }).click()
    await page.locator('button:has-text("Apply")').click()

    await expect.poll(() => page.evaluate(() => {
        function findById(node: any, id: string): any {
            if (!node) return
            if (node.id === id) return node
            for (const child of node.children || []) {
                const found = findById(child, id)
                if (found) return found
            }
        }
        const node = findById((window as any).state?.vfs, '/f1/')
        return {
            rootCanRead: (window as any).state?.vfs?.can_read,
            inheritedCanRead: node?.inherited?.can_read,
        }
    })).toEqual({
        rootCanRead: false,
        inheritedCanRead: false,
    })

    await selectVfsNode(page, 'f1', '/f1/')
    await page.locator('button:has-text("Apply")').click()

    await expect.poll(() => page.evaluate(() => {
        function findById(node: any, id: string): any {
            if (!node) return
            if (node.id === id) return node
            for (const child of node.children || []) {
                const found = findById(child, id)
                if (found) return found
            }
        }
        const node = findById((window as any).state?.vfs, '/f1/f2/')
        return {
            middleCanRead: findById((window as any).state?.vfs, '/f1/')?.can_read,
            inheritedCanRead: node?.inherited?.can_read,
        }
    })).toEqual({
        middleCanRead: null,
        inheritedCanRead: false,
    })
})
