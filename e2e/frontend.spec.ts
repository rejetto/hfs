import { test, expect, Page } from '@playwright/test'
import fs from 'fs'
import { wait } from '../src/cross'
import {
    clickAdminMenu, clickIconBtn, forwardConsole, loginAdmin, password, resetTimestamp, FRONTEND_URL, username
} from './common'

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
})

test('search1', async ({ page }) => {
    resetTimestamp()
    await page.goto(FRONTEND_URL)
    await page.getByRole('button', { name: 'Search' }).click()
    await page.locator('input[name="name"]').fill('a')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('12 folders').click()
    await page.getByRole('link', { name: 'cantListPage/ alfa.txt' }).click()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Clear search' }).click()

    await page.getByRole('button', { name: 'Search' }).click()
    await page.locator('input[name="name"]').fill('a*')
    await page.locator('input[name="name"]').press('Enter')
    await page.getByText('files, 36 B').click()

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
    await page.locator('div').filter({ hasText: 'ServedRequests are logged here. Empty to disable it.Not servedWrite errors in a different file. Empty to use same file.' }).nth(3).click()
    await clickIconBtn('Close', page)
    await clickAdminMenu(page, 'Language')
    await dataTableLoading()
    if (!isPhone)
        await expect(page.getByText('author', { exact: true })).toBeVisible() // wait for the layout to be stable
    await screenshot(page, '.MuiDataGrid-root')
    await clickAdminMenu(page, 'Plugins')
    await expect(page.getByText('antibrute')).toBeVisible() // wait for data
    await screenshot(page)
    await page.getByRole('tab', { name: 'Get more' }).click()
    await page.getByRole('tab', { name: 'updates' }).click()
    await clickAdminMenu(page, 'Custom HTML')
    await expect(page.getByRole('combobox', { name: 'Section Style' })).toBeVisible() // wait for data to be loaded
    await screenshot(page)
    await page.getByRole('main').click()
    await clickAdminMenu(page, 'Internet')
    await expect(page.getByText('Server')).toBeVisible({ timeout: 15000 }) // wait for data (get_nat can be very slow)
    await page.mouse.click(1, 1) // avoid focus inconsistencies
    await screenshot(page)
    await clickAdminMenu(page, 'Logout')
    await screenshot(page)
})

async function screenshot(page: Page, selectorForMask = '') {
    if (selectorForMask)
        selectorForMask = ',' + selectorForMask
    await wait(1000) // this accounts especially for our DataTable component which takes time to set the layout
    return expect(page).toHaveScreenshot({ fullPage: true, mask: [page.locator(`.maskInTests${selectorForMask}`)] })
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
    const addBtn = adminPage.getByRole('button').nth(1)
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
    await page.locator('.list-wrapper > div').press('Control+Backspace')
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
})
