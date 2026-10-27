import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import yaml from 'yaml'

const port = yaml.parse(readFileSync('tests/config.yaml', 'utf8')).port

test.beforeEach(async ({ page }) => {
    await page.routeWebSocket('**/~/api/**', socket => socket.close({ code: 1000 }))
})

test('leaving Home closes the version subscription', async ({ page }) => {
    let subscriptions = 0, closed = 0
    await page.addInitScript(() => {
        Object.assign(window, { HFS: { VERSION: '3.4.0', session: { username: 'admin', isAdmin: true } } })
    })
    await page.routeWebSocket(/\/~\/api\/get_version(?:\?|$)/, socket => {
        subscriptions++
        socket.onClose(() => { closed++ })
        socket.send(JSON.stringify({ version: '3.4.0' }))
    })
    await page.route('**/~/api/**', route => {
        const command = new URL(route.request().url()).pathname.split('/').pop()
        return route.fulfill({ json: command === 'get_status' ? { http: {}, https: {} }
            : command === 'refresh_session' ? { username: 'admin', isAdmin: true }
            : command === 'get_log_info' ? { current: {}, rotated: {} } : {} })
    })
    await page.goto(process.env.ADMIN_HOME_URL || `http://localhost:${port}/~/admin/`)
    await expect.poll(() => subscriptions - closed).toBeGreaterThan(0)
    await page.getByRole('link', { name: /^Logs/ }).click()
    await expect(page.getByRole('heading', { name: 'Logs', exact: true })).toBeVisible()
    await expect.poll(() => subscriptions - closed).toBe(0)
})

for (const scenario of ['before subscribing', 'on reconnect', 'while asking'])
    test(`reload after version change ${scenario}`, async ({ page }) => {
        let version = scenario === 'on reconnect' ? '3.4.0' : '3.4.1'
        let subscriptions = 0
        const english = JSON.parse(readFileSync('src/admin-langs/hfs-admin-lang-en.json', 'utf8'))
        await page.addInitScript(english => {
            Object.assign(window, { HFS: {
                VERSION: '3.4.0', lang: { en: english }, session: { username: 'admin', isAdmin: true },
            } })
        }, english)
        await page.routeWebSocket(/\/~\/api\/get_version(?:\?|$)/, socket => {
            subscriptions++
            socket.send(JSON.stringify({ version }))
            socket.close({ code: 1012 }) // abnormal closure exercises the shared abstraction's reconnect
        })
        await page.route('**/~/api/**', route => {
            const command = new URL(route.request().url()).pathname.split('/').pop()
            return route.fulfill({ json: command === 'get_status' ? { http: {}, https: {} }
                : command === 'refresh_session' ? { username: 'admin', isAdmin: true } : {} })
        })
        await page.goto(process.env.ADMIN_HOME_URL || `http://localhost:${port}/~/admin/`)
        const dialog = page.getByRole('dialog')
        if (scenario === 'on reconnect') {
            await expect.poll(() => subscriptions).toBeGreaterThan(1)
            await expect(dialog).toHaveCount(0)
            version = '3.4.1'
        }
        await expect(dialog).toContainText('Server version has changed (3.4.1). Reload the page?')
        await expect(dialog).toHaveCount(1)
        if (scenario === 'while asking') {
            version = '3.4.2'
            await expect(dialog).toContainText('Server version has changed (3.4.2). Reload the page?')
            await expect(page.locator('[role="dialog"]')).toHaveCount(1)
        }
        else {
            await dialog.getByRole('button', { name: "Don't", exact: true }).click()
            const previousSubscriptions = subscriptions
            await expect.poll(() => subscriptions).toBeGreaterThan(previousSubscriptions + 1)
            await expect(dialog).toHaveCount(0)
            version = '3.4.2'
            await expect(dialog).toContainText('Server version has changed (3.4.2). Reload the page?')
        }
        await Promise.all([
            page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
            dialog.getByRole('button', { name: 'Reload', exact: true }).click(),
        ])
    })

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
    await page.route('**/~/api/get_status', route => route.fulfill({ json: {
        http: { listening: true, port: 80 }, https: {}, started: new Date().toISOString(), updatePossible: false,
        autoCheckUpdateResult: { name: '99.0', tag_name: 'v99.0', isNewer: true, body: 'Release notes', prerelease: false, assets: [] },
    } }))
    await page.route('**/~/api/get_config', route => route.fulfill({ json: {} }))
    await page.goto(process.env.ADMIN_HOME_URL || `http://localhost:${port}/~/admin/`)
    await expect(page.locator('button').filter({ hasText: 'Install 99.0' })).toBeDisabled()
})
