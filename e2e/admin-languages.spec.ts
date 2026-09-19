import { expect, test } from '@playwright/test'

for (const width of [1280, 390]) {
    test(`language table shows only uploaded catalogs at ${width}px`, async ({ page }) => {
        test.skip(!process.env.ADMIN_LANGUAGES_URL, 'requires the Admin Vite server')
        const pageUrl = process.env.ADMIN_LANGUAGES_URL!
        const documentUrl = new URL(pageUrl)
        documentUrl.hash = ''
        await page.setViewportSize({ width, height: 850 })
        await page.addInitScript(() => {
            Object.assign(window, { HFS: {
                session: { username: 'admin', isAdmin: true },
                adminLangs: ['en', 'it'], adminLang: '', lang: { en: { translate: {} } },
            } })
        })
        let uploaded: { code: string, version: number, author: string } | undefined = { code: 'it', version: 2, author: 'Custom author' }
        let adminUploaded: typeof uploaded
        // mirror the server's language list injected into each Admin page load
        await page.route(documentUrl.href, async route => {
            const response = await route.fetch()
            const langs = ['en', 'it', ...adminUploaded ? [adminUploaded.code] : []]
            await route.fulfill({ response, body: (await response.text()).replace('<head>',
                `<head><script>HFS.adminLangs=${JSON.stringify(langs)}</script>`) })
        })
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route('**/~/api/**', async route => {
            const command = new URL(route.request().url()).pathname.split('/').pop()
            if (command === 'get_langs') {
                const rows = [
                    { code: 'en', embedded: true, version: 1, author: 'Embedded author' },
                    { code: 'it', embedded: true, version: 1, author: 'Embedded author' },
                    ...uploaded ? [{ ...uploaded, admin: false }] : [],
                    ...adminUploaded ? [{ ...adminUploaded, admin: true }] : [],
                ]
                await route.fulfill({ contentType: 'text/event-stream', body:
                    `data: ${JSON.stringify([...rows.map(row => ['+', row]), ['ready']])}\n\ndata: \n\n` })
            }
            else if (command === 'add_langs') {
                const { langs } = route.request().postDataJSON()
                if ('hfs-admin-lang-da.json' in langs)
                    adminUploaded = { code: 'da', ...JSON.parse(langs['hfs-admin-lang-da.json']) }
                else
                    uploaded = { code: 'it', ...JSON.parse(langs['hfs-lang-it.json']) }
                await route.fulfill({ json: {} })
            }
            else if (command === 'del_lang') {
                if (route.request().postDataJSON().admin) adminUploaded = undefined
                else uploaded = undefined
                await route.fulfill({ json: {} })
            }
            else await route.fulfill({ json: command === 'refresh_session'
                ? { username: 'admin', isAdmin: true } : { force_lang: '' } })
        })
        await page.goto(pageUrl)
        await expect(page.getByRole('heading', { name: 'Uploaded languages' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'See the documentation' })).toHaveAttribute('href',
            'https://github.com/rejetto/hfs/wiki/Translation#hfs-34-beta')
        const grid = page.getByRole('grid')
        await expect(grid.getByRole('row')).toHaveCount(2)
        await expect(grid.getByRole('gridcell', { name: 'IT', exact: true })).toBeVisible()
        await expect(grid).not.toContainText('Embedded author')
        await expect(page.getByRole('combobox', { name: 'Frontend language' })).toBeVisible()
        await expect(page.getByRole('combobox', { name: 'Admin language' })).toBeVisible()
        await page.getByRole('combobox', { name: 'Frontend language' }).click()
        await expect(page.getByRole('option', { name: /EN.*English/ })).toBeVisible()
        await page.keyboard.press('Escape')
        const chooser = page.waitForEvent('filechooser')
        await grid.getByRole('button', { name: 'Add', exact: true }).click()
        await (await chooser).setFiles({ name: 'hfs-lang-it.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ version: 3, author: 'Updated author', translate: {} })) })
        await expect(page.getByText('Loaded', { exact: true })).toBeVisible()
        await expect(grid.getByRole('row')).toHaveCount(2)
        if (width > 600) await expect(grid).toContainText('Updated author')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.getByRole('heading', { name: 'Uploaded languages' }).click()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        await grid.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Go', exact: true }).click()
        await expect(grid.getByRole('row')).toHaveCount(1)
        await expect(grid.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
        const adminChooser = page.waitForEvent('filechooser')
        await grid.getByRole('button', { name: 'Add', exact: true }).click()
        await (await adminChooser).setFiles({ name: 'hfs-admin-lang-da.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ version: 1, author: 'Admin author', translate: {} })) })
        await expect(grid.getByRole('gridcell', { name: 'Admin', exact: true })).toBeVisible()
        await expect(grid.getByRole('gridcell', { name: 'DA', exact: true })).toBeVisible()
        await page.getByRole('combobox', { name: 'Admin language' }).click()
        await expect(page.getByRole('option', { name: /DA.*Dansk/ })).toBeVisible()
        await page.keyboard.press('Escape')
        await page.getByRole('combobox', { name: 'Frontend language' }).click()
        await expect(page.getByRole('option', { name: /DA.*Dansk/ })).toHaveCount(0)
        await page.keyboard.press('Escape')
        await grid.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Go', exact: true }).click()
        await expect(grid.getByRole('row')).toHaveCount(1)
        expect(adminUploaded).toBeUndefined()
        expect(errors).toEqual([])
    })
}
