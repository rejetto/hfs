import { test, expect, Page } from '@playwright/test'
import fs from 'fs'
import { wait } from '../src/cross'
import {
    clickAdminMenu, clickIconBtn, forwardConsole, loginAdmin, password, resetTimestamp, FRONTEND_URL, username, TEST_PORT
} from './common'

const screenshotStyle = fs.readFileSync('e2e/screenshot.css', 'utf8')
const screenshotCounters = new WeakMap<object, number>()

// a generic test touch several parts
test('around1', async ({ page }) => {
    forwardConsole(page)
    resetTimestamp()
    await page.goto(FRONTEND_URL)
    await expect(page).toHaveTitle(/File server/)
    await screenshot(page)
    await page.getByRole('button', { name: 'Login' }).click()
    await expect(page.getByRole('dialog', {})).toBeVisible()
    await screenshot(page)

    await page.getByRole('textbox', { name: 'Username' }).fill(username + '!') // wrong username
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('x!ErrorInvalid credentials')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click()

    resetTimestamp()
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('div').filter({ hasText: 'Logged in' }).nth(3).click()
    await screenshot(page)

    // selecting in this folder should enable bulk delete button
    await page.getByRole('link', { name: 'for-admins, Folder' }).click()
    await page.getByRole('link', { name: 'upload, Folder' }).click()
    await page.getByRole('link', { name: 'alfa.txt' }).click()
    await expect(page.getByText('Delete')).toBeVisible() // first check single-delete command
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Select' }).click()
    await page.getByRole('checkbox', { name: 'alfa.txt' }).check()
    await expect(page.getByRole('button', { name: 'Delete' })).toBeEnabled()
    await page.getByRole('button', { name: 'Select' }).click()

    await page.getByRole('link', { name: 'home' }).click()
    await page.getByRole('button', { name: username }).click()
    await page.getByRole('button', { name: 'Logout' }).click()
    await page.getByText('Logged out').click()
    await page.getByRole('link', { name: 'cantListBut, Folder' }).click()
    await page.getByText('x!WarningForbidden').click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'cantListBut, Folder' }).click()
    await expect(page.getByRole('alertdialog').getByText('Forbidden')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'cantListPage, Folder' }).click()
    await page.getByRole('link', { name: 'alfa.txt' }).click()
    await expect(page.getByRole('dialog')).toMatchAriaSnapshot(`
    - dialog:
      - button "Close"
      - heading "File menu" [level=1]
      - term: Name
      - definition: alfa.txt
      - term: Size
      - definition: 6 B
      - term: Timestamp
      - definition: /\\d+\\/\\d+\\/\\d+, \\d+:\\d+:\\d+/
      - term: Creation
      - definition: /\\d+\\/\\d+\\/\\d+, \\d+:\\d+:\\d+/
      - link "Download"
      - link "Open"
    `)
    await page.getByRole('link', { name: 'Download' }).click() // this also closes the dialog
    await page.getByRole('link', { name: 'alfa.txt', exact: true }).click()
    await screenshot(page)
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('link', { name: 'cantListPage' }).click()
    await page.getByRole('button', { name: 'Calculate' }).click()
    await page.getByText('KB / 2 files').click()
    await page.locator('#menu-prop-name').getByText('cantListPage').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download' }).click()
    await downloadPromise
    await page.getByRole('link', { name: 'cantListPage' }).click()
    const pageListPromise = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Get list' }).click()
    const pageList = await pageListPromise
    await expect(pageList.getByText('::1')).toBeVisible()
    await pageList.close()

    await page.getByRole('link', { name: 'home' }).click()
    await page.getByRole('button', { name: 'Select' }).click()
    await page.getByRole('textbox', { name: 'Type here to filter the list' }).click()
    await page.getByRole('textbox', { name: 'Type here to filter the list' }).fill('x')
    await page.getByText('filtered').click()
    await screenshot(page)
    await page.getByRole('button', { name: 'Select' }).click()
    await page.getByText('file, 10 folders, 6 B').click()
    await page.getByRole('link', { name: 'cantListPageAlt, Folder' }).click()
    await page.getByRole('link', { name: 'home' }).click()
    await page.getByRole('link', { name: 'f1, Folder' }).click()
    await page.getByRole('link', { name: 'page, Folder' }).click()
    await page.getByRole('img', { name: 'gpl logo' }).click()
    await page.getByRole('heading', { name: 'This is a test' }).click()
    await page.goBack()
    await page.getByRole('link', { name: 'home' }).click()

    const isPhone = await page.evaluate(() => window.matchMedia("(max-width: 600px)").matches)
    if (isPhone)
        await page.getByRole('listitem').filter({ hasText: 'for-disabled' }).getByRole('button').click()
    else
        await page.getByRole('listitem').filter({ hasText: 'for-disabledMenu' }).getByRole('button').click()
    await expect(page.getByText('Missing permission')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'cantSearchForMasks, Folder' }).click()
    await expect(page.getByRole('link', { name: 'cantSearchForMasks' })).toBeVisible()
    await page.getByRole('link', { name: 'cantSearchForMasks' }).click()
    await expect(page.locator('#menu-prop-name').getByText('cantSearchForMasks')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'cantSearchForMasks' }).click()
    await expect(page.getByText('xFolder')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'home' }).click()

    await page.getByRole('button', { name: 'Options' }).click()
    await page.getByRole('slider').fill('6')
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.list-wrapper')).toHaveClass(/tiles-mode/)

    const item = page.locator('.list-wrapper li').filter({ has: page.locator('.link-wrapper > a') }).first()
    const link = item.locator('.link-wrapper > a')
    const name = item.locator('.entry-name')
    await expect(link).toBeVisible()
    await expect(name).toBeVisible()

    // safari can shrink the inline link box, so compare the geometry directly against the name
    const [linkBox, nameBox] = await Promise.all([link.boundingBox(), name.boundingBox()])
    expect(linkBox).not.toBeNull()
    expect(nameBox).not.toBeNull()
    expect(linkBox!.y + linkBox!.height).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1)
})

test('search1', async ({ page }) => {
    resetTimestamp()
    await page.goto(FRONTEND_URL)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.locator('input[name="name"]').fill('a')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('#menu-panel')).toHaveCSS('flex-direction', 'column-reverse')
    await page.getByText('12 folders').click()
    await page.getByRole('link', { name: 'cantListPage/ alfa.txt' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Clear search' }).click()

    await page.getByRole('button', { name: 'Search' }).click()
    await page.locator('input[name="name"]').fill('a*')
    await page.locator('input[name="name"]').press('Enter')
    await page.getByText('files, 42 B').click()

    await page.getByRole('link', { name: 'home' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'home' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Clear search' }).click()
    await page.getByRole('link', { name: 'home' }).click()
    await expect(page.getByText('xFolder')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Options' }).click()
    await expect(page.locator('#option-sort-by')).toBeVisible()
    await expect(page.locator('#option-sort-by')).toBeVisible()
    await page.getByRole('dialog').locator('div').nth(2).click()
    await page.locator('#option-sort-by').selectOption('size')
    await page.getByRole('checkbox', { name: 'Invert order' }).check()
    await page.getByRole('slider').fill('6')
    await page.locator('#option-theme').selectOption('dark')
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'cantListPageAlt, Folder' }).click()
    await expect(page.getByText('alfa.txt')).toBeVisible() // be sure the folder is loaded
    await page.mouse.click(1, 1) // avoid focus inconsistencies
    await screenshot(page)

    await page.getByRole('button', { name: 'Zip' }).click()
    await expect(page.getByRole('dialog')).toMatchAriaSnapshot(`
    - dialog:
      - button "Close"
      - heading "Confirm" [level=1]
      - paragraph: Download WHOLE folder as ZIP archive?
      - link "Yes":
        - button "Yes"
      - button "Don't"
      - button "Select some files"
    `)
    await page.getByRole('button', { name: "Don't" }).click()
    await page.getByRole('button', { name: 'Zip' }).click()
    await page.getByRole('button', { name: 'Select some files' }).click()
    await page.getByText('Use checkboxes to select the').click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('textbox', { name: 'Type here to filter the list' }).click()
})

test('select all resets when the list reloads', async ({ page }) => {
    await page.goto(FRONTEND_URL + 'for-admins/upload/')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('alfa.txt')).toBeVisible()
    await page.getByRole('button', { name: 'Select' }).click()

    const selectAll = page.getByRole('checkbox', { name: 'Select all' })
    await selectAll.check()
    await expect(page.getByText('1 selected')).toBeVisible()
    await page.evaluate(() => (window as any).HFS.reloadList())
    await expect(page.getByText('1 selected')).toHaveCount(0)
    await expect(selectAll).not.toBeChecked()
    await expect.poll(() => page.evaluate(() => Boolean((window as any).HFS.state.props))).toBe(true)

    await page.evaluate(() => {
        ;(window as any).HFS.state.props.can_archive = false
        ;(window as any).HFS.state.props.can_delete_children = false
        ;(window as any).HFS.state.showFilter = false
    })
    await expect(page.getByRole('textbox', { name: 'Type here to filter the list below' })).toBeHidden()
    await page.evaluate(() => {
        ;(window as any).selectionChecks = 0
        document.addEventListener('hfs.enableEntrySelection', () => ++(window as any).selectionChecks)
    })
    await page.evaluate(() => new Promise<void>(resolve => {
        const { state } = (window as any).HFS
        state.list = [...state.list]
        requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    expect(await page.evaluate(() => (window as any).selectionChecks)).toBe(0)
})

test('filter resets paging when the first entry stays the same', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await expect(page.getByRole('link', { name: 'cantListBut, Folder' })).toBeVisible()
    await page.evaluate(() => (window as any).HFS.state.page_size = 3)
    await page.locator('#paging > button').last().click()
    await expect(page.getByRole('link', { name: 'tests, Folder' })).toBeVisible()

    await page.getByRole('button', { name: 'Select' }).click()
    await page.locator('#filter').fill('cant')
    await expect(page.getByText('5 filtered')).toBeVisible()
    await expect(page.getByRole('link', { name: 'cantListBut, Folder' })).toBeVisible()
})

test('mobile timestamps keep updating after the first refresh', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 700 })
    await page.clock.install({ time: new Date('2026-08-31T23:55:00+02:00') })
    await page.goto(FRONTEND_URL)
    await page.clock.runFor(2_000)
    await page.evaluate(() => {
        const hfs = (window as any).HFS
        hfs.state.stopSearch?.()
        hfs.state.list = [new hfs.DirEntry('probe.txt', { m: new Date('2026-09-01T01:00:00+02:00') })]
        hfs.state.filteredList = undefined
        hfs.state.loading = false
    })
    const timestamp = page.locator('.entry-ts')
    const expectedTime = await page.evaluate(() => new Date('2026-09-01T01:00:00+02:00')
        .toLocaleString(navigator.language, { hour: '2-digit', minute: '2-digit' }))
    await expect(timestamp).toHaveText(expectedTime)

    await page.clock.runFor(10 * 60_000)
    await page.clock.fastForward(36 * 60 * 60_000)
    const expectedDate = await page.evaluate(() => new Date('2026-09-01T01:00:00+02:00')
        .toLocaleString(navigator.language, { year: '2-digit', month: '2-digit', day: '2-digit' }))
    await expect(timestamp).toHaveText(expectedDate)
})

test('stopping a regular listing is not labeled as a search', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await page.evaluate(() => (window as any).HFS.state.searchManuallyInterrupted = true)
    const icon = page.locator('#folder-stats [title="Interrupted"]')
    await expect(icon).toBeVisible()
    await expect.poll(() => icon.evaluate(el => getComputedStyle(el, '::before').content)).toMatch(/^".+"$/)
})

test('frontend-admin', async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready) // aspetta i font
    await page.getByRole('button', { name: 'Options' }).click()
    // no admin button yet,
    await expect(page.getByRole('dialog')).toMatchAriaSnapshot(`
    - dialog:
      - button "Close"
      - heading "Options" [level=1]
      - combobox:
        - 'option "Sort by: name" [selected]'
        - 'option "Sort by: extension"'
        - 'option "Sort by: size"'
        - 'option "Sort by: time"'
        - 'option "Sort by: creation"'
      - checkbox "Invert order"
      - text: Invert order
      - checkbox "Folders first" [checked]
      - text: Folders first
      - checkbox "Numeric names"
      - text: "Numeric names Tiles mode: off"
      - slider: "0"
      - combobox:
        - 'option "Theme: auto" [selected]'
        - 'option "Theme: light"'
        - 'option "Theme: dark"'
    `)
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Login' }).click()
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('textbox', { name: 'Password' }).press('Enter')
    await page.getByRole('button', { name: 'Options' }).click()
    const page1Promise = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Admin-panel' }).click()
    const page1 = await page1Promise
    await expect(page1).toHaveTitle(/HFS Admin-panel/)
})

test('current breadcrumb uses current folder delete permission', async ({ page }) => {
    await page.goto(FRONTEND_URL + 'f1/')
    await expect(page.getByRole('link', { name: 'f2, Folder' })).toBeVisible()
    const breadcrumb = page.locator('.breadcrumb').last()

    await page.evaluate(() => Object.assign((window as any).HFS.state.props, {
        can_delete: false,
        can_delete_children: true,
    }))
    await breadcrumb.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Folder menu' })).toBeVisible()
    await expect(dialog.locator('#menu-entry-rename')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()

    await page.evaluate(() => Object.assign((window as any).HFS.state.props, {
        can_delete: true,
        can_delete_children: false,
    }))
    await breadcrumb.click()
    await expect(page.locator('#menu-entry-rename')).toBeVisible()
})

test('admin1', async ({ page }) => {
    await fs.promises.rm('tests/work/logs', { force: true, recursive: true }) // clear logs to have consistent screenshots
    const isPhone = await loginAdmin(page)

    function dataTableLoading() {
        return expect(page.getByRole('grid').getByRole('img')).toBeVisible({ visible: false })
    }

    await clickAdminMenu(page, 'Internet') // initiate the get_nat process, so we'll have to wait less, later
    await clickAdminMenu(page, 'Shared files')
    await expect(page.getByText('cantListBut')).toBeVisible() // wait for data
    if (!isPhone)
        await expect(page.getByText('Your shared files')).toBeVisible() // wait for data
    await screenshot(page)
    await clickAdminMenu(page, 'Accounts')
    await expect(page.getByText('admins', { exact: true })).toBeVisible() // wait for data
    await screenshot(page)
    await page.getByText('rejetto(admins,').click()
    await screenshot(page)
    if (isPhone)
        await clickIconBtn('Close', page)
    await clickAdminMenu(page, 'Options')
    await expect(page.getByText('Correctly working on port')).toBeVisible() // wait for data
    if (!isPhone)
        await expect(page.getByText('Expire', { exact: true })).toBeVisible() // wait for layout of 'block' table
    await page.mouse.click(1, 1) // avoid focus inconsistencies
    await screenshot(page)

    await clickAdminMenu(page, 'Logs')
    await dataTableLoading()
    await screenshot(page)
    await clickIconBtn('Options', page)
    await page.getByRole('textbox', { name: 'Served', exact: true }).click()
    await clickIconBtn('Close', page)
    await clickAdminMenu(page, 'Language')
    await dataTableLoading()
    if (!isPhone)
        await expect(page.getByText('author', { exact: true })).toBeVisible() // wait for the layout to be stable
    await screenshot(page, '.MuiDataGrid-root')
    await clickAdminMenu(page, 'Plugins')
    await expect(page.getByText('antibrute')).toBeVisible() // wait for data
    // ensure Test plugin is running
    const stopTest = page.getByRole('button', { name: 'Stop test' })
    if (!await stopTest.isVisible()) {
        await page.getByRole('button', { name: 'Start test' }).click()
        await expect(stopTest).toBeVisible()
    }
    // reload the list from the server so the plugin screenshot doesn't depend on SSE timing
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop test' })).toBeVisible()

    await screenshot(page)
    await page.getByRole('tab', { name: 'Get more' }).click()
    await page.getByRole('tab', { name: 'updates' }).click()
    await clickAdminMenu(page, 'Custom HTML')
    await expect(page.getByRole('combobox', { name: 'Section Style' })).toBeVisible() // wait for data to be loaded
    await screenshot(page)
    await page.getByRole('main').click()
    await clickAdminMenu(page, 'Internet')
    await expect(page.getByText(`port ${TEST_PORT}`)).toBeVisible({ timeout: 15000 }) // wait for data (get_nat can be very slow)
    await page.mouse.click(1, 1) // avoid focus inconsistencies
    await screenshot(page)
    await clickAdminMenu(page, 'Logout')
    await screenshot(page)
})

async function screenshot(page: Page, selectorForMask = '') {
    if (process.env.NO_SS) return
    const testInfo = test.info()
    const snapshotName = nextScreenshotName(testInfo)
    const snapshotPath = testInfo.snapshotPath(snapshotName, { kind: 'screenshot' })
    if (selectorForMask)
        selectorForMask = ',' + selectorForMask
    await wait(200) // this accounts especially for our DataTable component which takes time to set the layout
    const mask = [page.locator(`.maskInTests${selectorForMask}`)]
    // write the missing baseline ourselves so Playwright does not turn the first run into a failure
    if (!fs.existsSync(snapshotPath)) {
        await page.screenshot({
            path: snapshotPath,
            fullPage: true,
            mask,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
            style: screenshotStyle,
        })
        return
    }
    return expect(page).toHaveScreenshot(snapshotName, { fullPage: true, mask })
}

function nextScreenshotName(testInfo: ReturnType<typeof test.info>) {
    const nextIndex = (screenshotCounters.get(testInfo) ?? 0) + 1
    screenshotCounters.set(testInfo, nextIndex)
    const testName = testInfo.titlePath.slice(1).join(' ')
    return `${testName}-${nextIndex}.png`
}

test('anew', async ({ page, browserName }) => {
    forwardConsole(page)
    if (page.viewportSize()?.width! < 1000 || browserName !== 'chromium') return // test only for desktop chromium
    // reset config so each run starts from the same default workspace state
    const port = 8082
    do {
        fs.writeFileSync('tests/work2/config.yaml', `port: ${port}\nopen_browser_at_start: false\n`)
        await wait(500)
    } while (await page.goto(`http://localhost:${port}/`).then(() => 0, () => 1))
    await expect(page.getByText('Nothing here')).toBeVisible()
    await page.getByRole('button', { name: 'Options' }).click()
    const page1Promise = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Admin-panel' }).click()
    const adminPage = await page1Promise
    await adminPage.getByRole('link', { name: 'add some' }).click()
    const addBtn = adminPage.getByRole('button', { name: 'Add item to virtual file system' })
    await addBtn.click()
    await adminPage.getByRole('menuitem', { name: 'from disk' }).click()
    await expect(adminPage.getByText('data.kv')).toBeVisible()
    await adminPage.getByRole('textbox', { name: /Filter results/ }).fill('data')
    await expect(adminPage.getByText('Filter results (1/')).toBeVisible()
    await adminPage.getByRole('checkbox').first().check()
    await adminPage.getByText('data.kv').first().click()
    await addBtn.click()
    await adminPage.getByRole('menuitem', { name: 'from disk' }).click()
    await adminPage.getByRole('button', { name: 'Select this folder' }).click()
    await addBtn.click()
    await adminPage.getByRole('menuitem', { name: 'virtual folder' }).click()
    await adminPage.getByRole('textbox').fill('folder1')
    await adminPage.getByRole('textbox').press('Enter')
    await adminPage.locator('#vfs').click()
    await adminPage.getByText('folder1', { exact: true }).click()
    await clickIconBtn('Cut', adminPage)
    await adminPage.locator('div').filter({ hasText: 'InfoNow that this is marked' }).nth(1).click()
    await clickIconBtn('Close', adminPage)
    await adminPage.getByRole('treeitem', { name: 'Home folder', exact: true })
        .getByText('Home folder', { exact: true }).click()
    await clickIconBtn('/work2/folder1/', adminPage) // paste button
    await adminPage.getByText('data.kv').click()
    await clickIconBtn('Cut', adminPage)
    await clickIconBtn('Close', adminPage)
    await adminPage.getByText('folder1').click()
    await clickIconBtn('/data.kv', adminPage) // paste
    await clickIconBtn('Save', adminPage)
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('link', { name: 'home' }).click()
    await page.getByRole('link', { name: 'Reload' }).click()
    await page.getByRole('link', { name: 'folder1, Folder' }).click()
    await page.getByRole('link', { name: 'data.kv' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.keyboard.press('Control+Backspace')
    await page.getByRole('link', { name: 'work2, Folder' }).click()
    await page.getByRole('link', { name: 'config.yaml', exact: true }).click()
    const page2Promise = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Open' }).click()
    const page2 = await page2Promise
    await page2.getByText(/folder1/).click()
})

test('order field', async ({ page }) => {
    await page.goto(FRONTEND_URL + 'renameChild/orderTest/')
    await expect(page.getByText('orderTest')).toBeVisible()
    await expect(page.locator('.entry-name')).toHaveText(['B', 'A', 'C'])
    await page.goto(FRONTEND_URL + 'renameChild/')
    await page.getByRole('link', { name: 'gui#%2, Folder' }).click()
    await expect(page.getByRole('link', { name: 'alfa.txt' })).toBeVisible()
    await expect(page.getByText('Not found')).not.toBeVisible()
})

test('renaming the current Unicode folder navigates to the new path', async ({ page, browserName }) => {
    if (browserName !== 'chromium') return
    const sourceName = 'rename-current-é'
    const destName = 'rename-current-done'
    const sourcePath = `tests/tmp/${sourceName}`
    const destPath = `tests/tmp/${destName}`
    cleanup()
    fs.mkdirSync(sourcePath, { recursive: true })
    fs.writeFileSync(`${sourcePath}/inside.txt`, 'inside')
    try {
        await page.goto(FRONTEND_URL)
        await page.getByRole('button', { name: 'Login' }).click()
        await page.getByRole('textbox', { name: 'Username' }).fill(username)
        await page.getByRole('textbox', { name: 'Password' }).fill(password)
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('button', { name: username })).toBeVisible()
        await page.goto(`${FRONTEND_URL}for-admins/upload/${encodeURIComponent(sourceName)}/`)
        await expect(page.getByRole('link', { name: 'inside.txt' })).toBeVisible()

        await page.locator('.breadcrumb').last().click()
        const folderDialog = page.getByRole('dialog')
        await expect(folderDialog.getByRole('heading', { name: 'Folder menu' })).toBeVisible()
        await folderDialog.getByRole('link', { name: 'Rename' }).click()
        const renameDialog = page.locator('.dialog-prompt')
        const renameInput = renameDialog.getByRole('textbox')
        await expect(renameInput).toHaveValue(sourceName)
        await renameInput.fill(destName)
        await renameDialog.getByRole('button', { name: 'Continue' }).click()

        const successDialog = page.getByRole('alertdialog')
        await expect(successDialog.getByText('Operation successful')).toBeVisible()
        await successDialog.getByRole('button', { name: 'Close' }).click()
        await expect(page).toHaveURL(`${FRONTEND_URL}for-admins/upload/${destName}/`)
        await expect(page.getByRole('link', { name: 'inside.txt' })).toBeVisible()
    }
    finally {
        cleanup()
    }

    function cleanup() {
        fs.rmSync(sourcePath, { recursive: true, force: true })
        fs.rmSync(destPath, { recursive: true, force: true })
    }
})

test('plugin resolves a Unicode file element to its entry', async ({ page, browserName }) => {
    if (browserName !== 'chromium') return
    const name = 'element-entry-é.txt'
    const path = `tests/tmp/${name}`
    fs.rmSync(path, { force: true })
    fs.mkdirSync('tests/tmp', { recursive: true })
    fs.writeFileSync(path, 'entry')
    try {
        await page.goto(FRONTEND_URL)
        const initial = await page.evaluate(() => {
            let value: unknown = 'callback not called'
            const unwatch = (window as any).HFS.watchState('upload.progress', (next: unknown) => value = next, true)
            unwatch()
            return value
        })
        expect(initial).toBe(0)

        await page.getByRole('button', { name: 'Login' }).click()
        await page.getByRole('textbox', { name: 'Username' }).fill(username)
        await page.getByRole('textbox', { name: 'Password' }).fill(password)
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('button', { name: username })).toBeVisible()
        await page.goto(`${FRONTEND_URL}for-admins/upload/`)

        const found = await page.getByRole('link', { name }).evaluate(el =>
            Boolean((window as any).HFS.elementToEntry(el)))
        expect(found).toBe(true)
    }
    finally {
        fs.rmSync(path, { force: true })
    }
})

test('file show does not advance ended media while auto-play is off', async ({ page, browserName }) => {
    if (browserName !== 'chromium') return
    const names = ['show-ended-a.wav', 'show-ended-b.wav']
    const wav = Buffer.from('UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA', 'base64')
    fs.mkdirSync('tests/tmp', { recursive: true })
    names.forEach(name => fs.writeFileSync(`tests/tmp/${name}`, wav))
    await page.addInitScript(() => { HTMLMediaElement.prototype.play = async () => {} })
    try {
        await page.goto(FRONTEND_URL)
        await page.getByRole('button', { name: 'Login' }).click()
        await page.getByRole('textbox', { name: 'Username' }).fill(username)
        await page.getByRole('textbox', { name: 'Password' }).fill(password)
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('button', { name: username })).toBeVisible()
        await page.goto(`${FRONTEND_URL}for-admins/upload/`)
        await page.getByRole('link', { name: names[0], exact: true }).click()
        await page.getByRole('link', { name: 'Show' }).click()
        await expect(page.getByRole('button', { name: 'Auto-play' })).toHaveAttribute('aria-pressed', 'false')

        await page.locator('.file-show audio').dispatchEvent('ended')
        await expect(page.locator('.file-show .filename')).toContainText(names[0])
    }
    finally {
        names.forEach(name => fs.rmSync(`tests/tmp/${name}`, { force: true }))
    }
})

test('file show keeps direction when skipping a broken image', async ({ page, browserName }) => {
    if (browserName !== 'chromium') return
    const names = ['show-prev-a.png', 'show-prev-b.png', 'show-prev-c.png']
    fs.copyFileSync('tests/page/gpl.png', `tests/page/${names[0]}`)
    fs.writeFileSync(`tests/page/${names[1]}`, 'broken image')
    fs.copyFileSync('tests/page/gpl.png', `tests/page/${names[2]}`)
    try {
        await page.goto(`${FRONTEND_URL}tests/page/`)
        await page.getByRole('link', { name: names[2], exact: true }).click()
        await page.getByRole('link', { name: 'Show' }).click()
        await expect.poll(() => page.locator('.file-show img').evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

        await page.keyboard.press('ArrowLeft')
        await expect(page.locator('.file-show .filename')).toContainText(names[0])
    }
    finally {
        names.forEach(name => fs.rmSync(`tests/page/${name}`, { force: true }))
    }
})

test('file show stops auto-play after a broken last image', async ({ page, browserName }) => {
    if (browserName !== 'chromium') return
    const names = ['show-forward-a.png', 'show-forward-b.png']
    fs.copyFileSync('tests/page/gpl.png', `tests/page/${names[0]}`)
    fs.writeFileSync(`tests/page/${names[1]}`, 'broken image')
    try {
        await page.goto(`${FRONTEND_URL}tests/page/`)
        await expect(page.getByRole('link', { name: names[1], exact: true })).toBeVisible()
        await page.evaluate(names => {
            const HFS = (window as any).HFS
            const entries = Object.fromEntries(HFS.state.list.map((entry: any) => [entry.name, entry]))
            HFS.state.list = names.map(name => entries[name])
        }, names)
        await page.getByRole('link', { name: names[0], exact: true }).click()
        await page.getByRole('link', { name: 'Show' }).click()
        const autoPlay = page.getByRole('button', { name: 'Auto-play' })
        await autoPlay.click()
        await expect(autoPlay).toHaveAttribute('aria-pressed', 'true')

        await page.locator('.file-show .nav').last().click()
        await expect(autoPlay).toHaveAttribute('aria-pressed', 'false')
    }
    finally {
        names.forEach(name => fs.rmSync(`tests/page/${name}`, { force: true }))
    }
})

test('English option updates the page language', async ({ page }) => {
    await page.goto(FRONTEND_URL + '?lang=it')
    const content = page.locator('#root > [lang]')
    await expect(content).toHaveAttribute('lang', 'it')
    await expect(page.locator('#options-button')).toHaveAttribute('aria-label', 'Opzioni')

    await page.locator('#options-button').click()
    await page.locator('#option-english input').check()
    await expect(page.locator('#options-button')).toHaveAttribute('aria-label', 'Options')
    await expect(content).toHaveAttribute('lang', 'en')
})

test('plugin icons render keycap emoji', async ({ page }) => {
    await page.addInitScript(() => {
        document.addEventListener('hfs.entryIcon', (event: Event) => {
            const hfs = (window as any).HFS
            ;(event as CustomEvent).detail.output.push(hfs.h(hfs.Icon, {
                name: '1️⃣',
                alt: 'plugin keycap icon',
            }))
        })
    })
    await page.goto(FRONTEND_URL)

    await expect(page.getByRole('img', { name: 'plugin keycap icon' }).first()).toHaveText('1️⃣')
})

test('frontend polyfills are installed before shared code runs', async ({ page }) => {
    await page.addInitScript(() => {
        delete (Object as any).fromEntries
    })
    await page.goto(FRONTEND_URL)

    await expect(page.locator('#options-button')).toBeVisible()
})

test('cut is disabled without a selection', async ({ page }) => {
    await page.goto(FRONTEND_URL + 'for-admins/upload/')
    await page.getByRole('textbox', { name: 'Username' }).fill(username)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('link', { name: 'alfa.txt' })).toBeVisible()
    await page.getByRole('button', { name: 'Select' }).click()

    const selection = page.getByRole('checkbox', { name: 'alfa.txt' })
    const cut = page.getByRole('button', { name: 'Cut' })
    const clipboard = page.getByRole('button', { name: /Clipboard/ })
    await selection.check()
    await cut.click()
    await expect(clipboard).toBeVisible()

    await selection.uncheck()
    await expect(cut).toBeDisabled()
    await expect(clipboard).toBeVisible()
})
