import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port
const url = process.env.ADMIN_CUSTOM_HTML_URL || `http://localhost:${port}/~/admin/#/html`
const initial = { top: '<p>original</p>', bottom: '<footer>original</footer>' }

test('save completion preserves newer edits in custom HTML sections', async ({ page }) => {
    await page.route('**/~/api/get_custom_html', route => route.fulfill({ json: { enabled: true, sections: initial } }))
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    await page.route('**/~/api/set_custom_html', async route => {
        await pending
        await route.fulfill({ json: {} })
    })
    await page.goto(url)
    const editor = page.locator('main textarea')
    await expect(editor).toHaveValue(initial.top)
    await editor.fill('<p>submitted</p>')
    const request = page.waitForRequest('**/~/api/set_custom_html')
    await page.getByRole('button', { name: /Save/ }).click()
    expect((await request).postDataJSON()).toEqual({ sections: { ...initial, top: '<p>submitted</p>' } })
    await editor.fill('<p>newer edit</p>')
    const response = page.waitForResponse('**/~/api/set_custom_html')
    complete()
    await response
    await expect(page.getByRole('button', { name: /Save/ }).locator('.MuiCircularProgress-root')).toHaveCount(0)
    await expect(editor).toHaveValue('<p>newer edit</p>')
    await page.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(editor).toHaveValue(initial.top)
})

test('loading custom HTML prevents saving an empty replacement', async ({ page }) => {
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    await page.route('**/~/api/get_custom_html', async route => {
        await pending
        await route.fulfill({ json: { enabled: true, sections: initial } })
    })
    const saved: unknown[] = []
    await page.route('**/~/api/set_custom_html', route => {
        saved.push(route.request().postDataJSON())
        return route.fulfill({ json: {} })
    })
    const request = page.waitForRequest('**/~/api/get_custom_html')
    await page.goto(url)
    await request
    await page.keyboard.press('ControlOrMeta+s')
    expect(saved).toEqual([])
    await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0)
    complete()
    const editor = page.locator('main textarea')
    await expect(editor).toHaveValue(initial.top)
    await page.route('**/~/api/set_custom_html', route => route.fulfill({ json: {} }))
    await editor.fill('<p>first edit</p>')
    const saveRequest = page.waitForRequest('**/~/api/set_custom_html')
    await page.getByRole('button', { name: /Save/ }).click()
    expect((await saveRequest).postDataJSON()).toEqual({ sections: { ...initial, top: '<p>first edit</p>' } })
    await expect(editor).toHaveValue('<p>first edit</p>')
})
