import { expect, test } from '@playwright/test'
import english from '../src/admin-langs/hfs-admin-lang-en.json'

for (const [proto, externalPort] of [['http', 9000], ['http', 80], ['https', 9443], ['https', 443], ['https', 0], ['https', undefined]] as const)
    test(`main address uses ${proto} public port ${externalPort ?? 'NAT unavailable'}`, async ({ page }) => {
        const internalPort = 8081
        const ips = ['192.168.1.2', '127.0.0.1', '[fd00::2]', '[::1]', '203.0.113.2', '[2001:db8::2]']
        const publicPort = externalPort || internalPort
        const suffix = publicPort === (proto === 'https' ? 443 : 80) ? '' : ':' + publicPort
        const publicUrl = `${proto}://203.0.113.2${suffix}`
        let saved: unknown
        let statusRequests = 0
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.addInitScript(english => {
            Object.assign(window, { HFS: { lang: { en: english }, session: { username: 'admin', isAdmin: true } } })
        }, english)
        await page.route('**/~/api/**', route => {
            const command = new URL(route.request().url()).pathname.split('/').pop()
            if (command === 'get_nat' && externalPort === undefined)
                return route.fulfill({ status: 500, body: 'NAT unavailable' })
            if (command === 'set_config')
                saved = route.request().postDataJSON().values.base_url
            return route.fulfill({ json: command === 'get_status' ? {
                http: { listening: proto === 'http', port: internalPort },
                https: { listening: proto === 'https', port: internalPort },
                urls: { [proto]: ips.map(ip => `${proto}://${ip}:${internalPort}`) },
                baseUrl: ++statusRequests === 1 ? `${proto}://${ips[0]}:${internalPort}` : publicUrl,
            } : command === 'get_nat' ? { proto, internalPort, externalPort, localIp: ips[0] }
                : command === 'get_config' ? { base_url: saved || '', roots: {} }
                : command === 'get_public_ips' ? ['203.0.113.2', '2001:db8::2']
                : command === 'get_cert' ? { none: true }
                : command === 'get_acme' ? { domain: '', providers: [], dns: [], challenge: 'http-01' }
                : command === 'refresh_session' ? { username: 'admin', isAdmin: true } : {} })
        })
        await page.goto(`http://127.0.0.1:${process.env.HFS_TEST_ADMIN_PORT || 3112}/#/internet`)
        await expect(page.getByText('Main address: Automatic')).toBeVisible()
        await expect(page.locator('tt').filter({ hasText: publicUrl })).toBeVisible()
        await page.getByRole('button', { name: 'Copy', exact: true }).click()
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(publicUrl)
        await page.getByRole('button', { name: 'Change address', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('menuitem')).toHaveText([
            'Automatic',
            ...ips.slice(0, 4).map(ip => `${proto}://${ip}:${internalPort}`),
            publicUrl,
            `${proto}://[2001:db8::2]${suffix}`,
        ])
        await dialog.getByRole('menuitem', { name: publicUrl, exact: true }).click()
        await dialog.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(() => saved).toBe(publicUrl)
        await expect(page.getByText('Main address: Automatic')).toHaveCount(0)
    })
