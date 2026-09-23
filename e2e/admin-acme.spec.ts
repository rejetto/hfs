import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { dnsProviderInfo } from '../src/acmeDns'
import catalog from '../central.json'
import english from '../src/admin-langs/hfs-admin-lang-en.json'

test('DNS provider selection, wildcard helper, secret autosave and streamed progress', async ({ page }) => {
    test.skip(!process.env.ADMIN_ACME_URL, 'requires the Admin Vite server')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(english => {
        Object.assign(window, { HFS: { lang: { en: english }, session: { username: 'admin', isAdmin: true } } })
        class StatusSource {
            CLOSED = 2
            readyState = 1
            onmessage: ((event: { data: string }) => void) | null = null
            onerror: (() => void) | null = null
            constructor(url: string) {
                if (url.includes('get_acme_status')) {
                    Object.assign(window, { acmeUpdate: (value: object) => this.onmessage?.({ data: JSON.stringify(value) }) })
                    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: 0, state: 'idle', message: '' }) }), 0)
                }
            }
            close() { this.readyState = 2 }
            addEventListener() {}
            removeEventListener() {}
        }
        Object.assign(window, { EventSource: StatusSource })
    }, english)
    const settings = { domain: '', challenge: 'http-01', renew: false, dns: [] as object[], providers: dnsProviderInfo(catalog.acmeDns) }
    let writes = 0, requests = 0
    await page.route('**/~/api/**', async route => {
        const command = new URL(route.request().url()).pathname.split('/').pop()
        if (command === 'get_acme') return route.fulfill({ json: settings })
        if (command === 'set_acme') {
            Object.assign(settings, route.request().postDataJSON().settings)
            writes++
            return route.fulfill({ json: settings })
        }
        if (command === 'make_cert') {
            const body = route.request().postDataJSON()
            expect(body).toEqual({ domain: '*.example.com', altNames: [], background: true })
            requests++
            return route.fulfill({ json: { id: 1 } })
        }
        return route.fulfill({ json: command === 'refresh_session' ? { username: 'admin', isAdmin: true } : {} })
    })
    await page.route('**/src/MonitorPage.ts*', route => route.fulfill({ contentType: 'text/javascript',
        body: `export { default } from ${JSON.stringify('/@fs/' + resolve('e2e/fixtures/acme.ts'))}` }))
    await page.goto(process.env.ADMIN_ACME_URL!)
    await expect(page.getByRole('link', { name: 'Read more', exact: true })).toHaveAttribute('href', 'https://github.com/rejetto/hfs/wiki/Certificate-validation')
    const domain = page.getByRole('textbox', { name: 'Domain for certificate' })
    await domain.fill('*.example.com')
    await domain.press('Tab')
    await page.getByRole('combobox', { name: 'Validation' }).click()
    await expect(page.getByRole('option', { name: /\S/ })).toHaveText(['HTTP', 'Select a DNS provider', 'DNS · Cloudflare', 'DNS · DigitalOcean', 'DNS · DNSimple', 'DNS · IONOS', 'DNS · Linode', 'DNS · Name.com', 'DNS · OVHcloud', 'DNS · OVHcloud Canada', 'DNS · Porkbun', 'DNS · Vultr'])
    await page.getByRole('option', { name: 'HTTP', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('HTTP validation cannot issue wildcard certificates. Select a DNS provider.')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('combobox', { name: 'Validation' }).click()
    await page.getByRole('option', { name: 'DNS · OVHcloud Canada', exact: true }).click()
    await expect(page.getByLabel('Application key', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Application secret', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Consumer key', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'How to get credentials' })).toHaveAttribute('href', 'https://ca.api.ovh.com/createToken/?POST=/domain/zone/*&DELETE=/domain/zone/*')
    const applicationKey = await page.getByLabel('Application key', { exact: true }).boundingBox()
    const applicationSecret = await page.getByLabel('Application secret', { exact: true }).boundingBox()
    expect(applicationKey!.y).toBe(applicationSecret!.y)
    expect(applicationKey!.x).toBeLessThan(applicationSecret!.x)
    await page.getByRole('combobox', { name: 'Validation' }).click()
    await page.getByRole('option', { name: 'DNS · DigitalOcean', exact: true }).click()
    await page.getByLabel('API token', { exact: true }).fill('test-secret')
    await page.getByLabel('API token', { exact: true }).press('Tab')
    await expect.poll(() => writes).toBeGreaterThanOrEqual(3)
    const request = page.getByRole('button', { name: 'Request', exact: true })
    await expect(request).toBeEnabled()
    await page.reload()
    await expect(page.getByLabel('API token', { exact: true })).toHaveValue('test-secret')
    await expect(request).toBeEnabled()
    await request.click()
    await expect.poll(() => requests).toBe(1)
    await emit({ id: 1, state: 'running', message: 'Waiting for DNS propagation', domain: 'example.com' })
    await expect(page.getByText('Waiting for DNS propagation', { exact: false })).toBeVisible()
    await expect(request).toBeDisabled()
    await emit({ id: 1, state: 'done', message: 'Certificate created' })
    await expect(page.getByText('completed=1')).toBeVisible()
    await expect(request).toBeEnabled()
    const apiError = 'DNS API returned HTTP 403 (POST eu.api.ovh.com /domain/zone/{zone}/record)'
    await emit({ id: 2, state: 'error', message: apiError })
    await expect(page.getByText(apiError, { exact: true })).toBeVisible()
    await expect(page.getByText('Failed to load page', { exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
    await page.screenshot({ path: '/tmp/hfs-acme-ui.png', fullPage: true })

    async function emit(value: object) {
        await page.evaluate(value => (window as unknown as { acmeUpdate(v: object): void }).acmeUpdate(value), value)
    }
})
