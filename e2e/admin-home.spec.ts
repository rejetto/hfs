import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port

for (const delayed of ['set_config', 'get_config'])
    test(`autosave blocks changes while ${delayed} is pending`, async ({ page }) => {
        const config = { auto_check_update: false, update_to_beta: false }
        let release!: () => void
        const pending = new Promise<void>(resolve => { release = resolve })
        let writes = 0
        await page.addInitScript(() => { Object.assign(window, { HFS: { session: { username: 'admin', isAdmin: true } } }) })
        await page.route('**/~/api/**', async route => {
            const command = route.request().url().split('/').at(-1)?.split('?')[0]
            if (command === 'set_config') {
                writes++
                if (writes === 1 && delayed === 'set_config')
                    await pending
                Object.assign(config, route.request().postDataJSON().values)
                return route.fulfill({ json: {} })
            }
            if (command === 'get_config' && writes === 1 && delayed === 'get_config')
                await pending
            return route.fulfill({ json: command === 'get_config' ? { ...config }
                : command === 'get_status' ? { http: {}, https: {} }
                : command === 'refresh_session' ? { username: 'admin', isAdmin: true }
                : {} })
        })
        try {
            await page.goto(process.env.ADMIN_HOME_URL || `http://localhost:${port}/~/admin/`)
            await page.getByRole('checkbox', { name: 'Auto check updates daily', exact: true }).click()
            await expect(page.getByRole('checkbox', { name: 'Auto check updates daily', exact: true })).toBeChecked()
            await expect.poll(() => writes).toBe(1)
            const beta = page.getByRole('checkbox', { name: 'Include beta versions', exact: true })
            await expect(page.locator('form[inert]')).toHaveCount(1)
            const bounds = await beta.boundingBox()
            await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
            await expect(beta).not.toBeChecked()
            release()
            await expect(page.locator('form[inert]')).toHaveCount(0)
            await expect.poll(() => config).toEqual({ auto_check_update: true, update_to_beta: false })
            await beta.click()
            await expect.poll(() => config).toEqual({ auto_check_update: true, update_to_beta: true })
            await expect(page.getByRole('checkbox', { name: 'Include beta versions', exact: true })).toBeChecked()
        }
        finally { release() }
    })

test('Install stays disabled when automatic updates are unsupported', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('admin_state', JSON.stringify({ hideRandomPlugin: true })))
    await page.route('**/~/api/get_plugins*', route => route.fulfill({ contentType: 'text/event-stream', body: '' }))
    await page.route('**/~/api/get_status', route => route.fulfill({ json: {
        http: { listening: true, port: 80 }, https: {}, started: new Date().toISOString(), updatePossible: false,
        autoCheckUpdateResult: { name: '99.0', tag_name: 'v99.0', isNewer: true, body: 'Release notes', prerelease: false, assets: [] },
    } }))
    await page.route('**/~/api/get_config', route => route.fulfill({ json: {} }))
    await page.goto(process.env.ADMIN_HOME_URL || `http://localhost:${port}/~/admin/`)
    await expect(page.locator('button').filter({ hasText: 'Install 99.0' })).toBeDisabled()
})
