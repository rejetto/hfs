import { test, expect } from '@playwright/test'
import { spawn, ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer, Server as HttpServer, ServerResponse } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import yaml from 'yaml'

let cwd: string
let server: ChildProcess
let externalServer: HttpServer
let base: string
let externalBase: string
let output = ''
let slowScriptResponse: ServerResponse | undefined
let slowScriptRequested: (() => void) | undefined
let fallbackScriptRequests = 0

test.beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'hfs-admin-plugin-'))
    const socket = createNetServer().listen(0, '127.0.0.1')
    await once(socket, 'listening')
    const port = (socket.address() as { port: number }).port
    await new Promise<void>(resolve => socket.close(() => resolve()))
    base = `http://127.0.0.1:${port}`
    externalServer = createHttpServer((req, res) => {
        res.setHeader('content-type', 'text/javascript')
        if (req.url === '/external-admin.js')
            return res.end(`window.externalPluginRestCall = () => HFS.customRestCall('pluginProbe')`)
        if (req.url === '/external-admin.js?v=2')
            return res.end(`window.prefixedExternalRestCall = () => HFS.customRestCall('pluginProbe')`)
        if (req.url === '/unique-admin.js')
            return res.end(`window.pluginRestCallThroughSharedHelper = () => window.invokePluginCallback(() => HFS.customRestCall('pluginProbe'))`)
        if (req.url === '/shared-helper.js')
            return res.end(`window.invokePluginCallback = callback => callback()`)
        if (['/slow-admin.js', '/dep-a.js', '/slow-child.js'].includes(req.url || '')) {
            slowScriptResponse = res
            slowScriptRequested?.()
            return
        }
        if (req.url === '/fallback-child.js') {
            fallbackScriptRequests++
            return
        }
        res.statusCode = 404
        res.end()
    }).listen(0, '127.0.0.1')
    await once(externalServer, 'listening')
    const externalPort = (externalServer.address() as { port: number }).port
    externalBase = `http://127.0.0.1:${externalPort}`
    await mkdir(join(cwd, 'plugins/admin-api/public'), { recursive: true })
    await mkdir(join(cwd, 'plugins/admin-api-duplicate'), { recursive: true })
    await mkdir(join(cwd, 'plugins/late-login/public'), { recursive: true })
    await mkdir(join(cwd, 'plugins/slow-admin'), { recursive: true })
    await mkdir(join(cwd, 'plugins/dep-a'), { recursive: true })
    await mkdir(join(cwd, 'plugins/dep-b/public'), { recursive: true })
    await mkdir(join(cwd, 'plugins/child-loader/public'), { recursive: true })
    await writeFile(join(cwd, 'config.yaml'), yaml.stringify({
        port, localhost_admin: false, open_browser_at_start: false,
        enable_plugins: ['admin-api'],
        accounts: { admin: { password: 'test-password', admin: true } },
    }))
    await writeFile(join(cwd, 'plugins/admin-api/plugin.js'), `
exports.apiRequired = 13.72
exports.repo = 'test/hfs-probe'
exports.admin_js = ['first.js', 'admin.js', '${externalBase}/shared-helper.js', '${externalBase}/external-admin.js', '${externalBase}/unique-admin.js']
exports.admin_css = 'admin.css'
exports.frontend_js = 'frontend.js'
exports.frontend_css = 'frontend.css'
exports.config = {
    message: { defaultValue: 'saved', label: 'Probe message' },
    publicPath: { type: 'vfs_path', frontend: true, defaultValue: 'files' },
}
exports.onFrontendConfig = config => ({ ...config, decoratedPath: 'decorated:' + config.publicPath })
exports.init = api => {
    api.events.on('finalizingLogin', ({ inputs }) => {
        if (inputs.otp !== '123456') return "invalid test OTP"
    })
    return { customRest: { pluginProbe({}, ctx) {
        if (!api.ctxAdminAccess(ctx)) throw 403
        return { message: "Plugin endpoint works" }
    }, frontendProbe: () => ({ frontend: true }), 'admin-api:legacyProbe': () => ({ legacy: true }) } }
}
`)
    await writeFile(join(cwd, 'plugins/admin-api-duplicate/plugin.js'), `
exports.apiRequired = 13.72
exports.repo = 'test/hfs-probe'
exports.admin_js = ['${externalBase}/shared-helper.js', '${externalBase}/external-admin.js?v=2']
exports.customRest = { pluginProbe: () => ({ message: "Duplicate endpoint" }) }
`)
    await writeFile(join(cwd, 'plugins/late-login/plugin.js'), `
exports.apiRequired = 14
exports.admin_js = 'admin.js'
`)
    await writeFile(join(cwd, 'plugins/late-login/public/admin.js'), `
HFS.onEvent('beforeLogin', () => HFS.h('p', {}, "Late login extension"))
`)
    await writeFile(join(cwd, 'plugins/slow-admin/plugin.js'), `
exports.apiRequired = 14
exports.admin_js = '${externalBase}/slow-admin.js'
`)
    await writeFile(join(cwd, 'plugins/dep-a/plugin.js'), `
exports.apiRequired = 14
exports.admin_js = '${externalBase}/dep-a.js'
`)
    await writeFile(join(cwd, 'plugins/dep-b/plugin.js'), `
exports.apiRequired = 14
exports.afterPlugin = 'dep-a'
exports.admin_js = 'admin.js'
`)
    await writeFile(join(cwd, 'plugins/dep-b/public/admin.js'), `window.depBResult = window.depHelper()`)
    await writeFile(join(cwd, 'plugins/child-loader/plugin.js'), `
exports.apiRequired = 14
exports.admin_js = 'admin.js'
`)
    await writeFile(join(cwd, 'plugins/child-loader/public/admin.js'), `
void HFS.loadScript('${externalBase}/slow-child.js')
    .catch(() => HFS.loadScript('${externalBase}/fallback-child.js'))
    .catch(() => {})
`)
    await writeFile(join(cwd, 'plugins/admin-api/public/first.js'), 'window.pluginFirstLoaded = true')
    await writeFile(join(cwd, 'plugins/admin-api/public/admin.js'), `
'use strict'; {
if (!window.pluginFirstLoaded) throw Error('script order')
const { h } = HFS
const { StringField, Box, Btn } = HFS.admin.components
HFS.onEvent('unload:', () => window.pluginCleanupCalls = (window.pluginCleanupCalls || 0) + 1)
HFS.onEvent('beforeLogin', () => h('p', {}, "Plugin login extension"))
HFS.onEvent('beforeLoginSubmit', () => h(OTPInput))
window.pluginOwnRestCall = () => HFS.customRestCall('pluginProbe')
function OTPInput() {
    const [otp, setOtp] = HFS.React.useState('')
    return h(StringField, {
        name: 'otp', label: "OTP", value: otp, onChange: setOtp, typing: true,
        autoComplete: 'one-time-code', inputProps: { inputMode: 'numeric' },
    })
}
HFS.onEvent('pluginBeforeOptions:', ({ values }) => h(Box, {},
    h('p', { id: 'options-probe' }, values.message),
    h(Btn, { onClick: () => HFS.customRestCall('pluginProbe'), doneMessage: "Sent: " + values.message }, "Test current options")))
HFS.admin.addPage({ id: 'probe', label: "Plugin probe", icon: ProbeIcon, component: Probe })
function ProbeIcon() {
    return h('span', { 'data-testid': 'plugin-page-icon' }, "P")
}
function Probe({ setTitleSide }) {
    const [message, setMessage] = HFS.React.useState('')
    setTitleSide(HFS.React.useMemo(() =>
        h('span', { 'data-testid': 'plugin-title-side' }, "Plugin title side"), []))
    return h(Box, { id: 'plugin-probe' },
        h('p', {}, "Plugin page content"),
        h(Btn, { onClick: async () => setMessage((await HFS.customRestCall('pluginProbe')).message) }, "Call plugin"),
        h('p', {}, message))
}
}
`)
    await writeFile(join(cwd, 'plugins/admin-api/public/admin.css'), '#plugin-probe { border-top: 7px solid rgb(1, 2, 3) }')
    await writeFile(join(cwd, 'plugins/admin-api/public/frontend.js'), `window.frontendPluginLoaded = true
HFS.onEvent('afterHeader', () => HFS.h('p', {}, "Frontend plugin extension"))
HFS.onEvent('beforeLoginSubmit', () => HFS.h('input', { name: 'otp', placeholder: "Frontend OTP" }))
window.frontendPluginRestCall = () => HFS.customRestCall('frontendProbe')
`)
    await writeFile(join(cwd, 'plugins/admin-api/public/frontend.css'), ':root { --frontend-plugin: yes }')
    server = spawn(process.execPath, [resolve('dist/src'), '--cwd', cwd], { stdio: ['ignore', 'pipe', 'pipe'] })
    server.stdout!.on('data', chunk => output += chunk)
    server.stderr!.on('data', chunk => output += chunk)
    for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw Error(output)
        const res = await fetch(base + '/~/admin/').catch(() => undefined)
        if (res?.ok && (await res.text()).includes('admin.js')) return
        await delay(100)
    }
    throw Error('Server failed to become ready: ' + output)
})

test.afterAll(async () => {
    if (server && server.exitCode === null) {
        server.kill()
        await once(server, 'exit')
    }
    slowScriptResponse?.destroy()
    if (externalServer)
        await new Promise<void>(resolve => externalServer.close(() => resolve()))
    if (cwd) await rm(cwd, { recursive: true, force: true })
})

test('plugin assets, OTP login and menu page use the real Admin flow', async ({ page, request }) => {
    await page.goto(base + '/~/admin/')
    await expect(page.evaluate(() => ({
        loadPlugin: 'loadPlugin' in HFS.admin,
        unloadPlugin: 'unloadPlugin' in HFS.admin,
        onUnload: 'onUnload' in HFS.admin,
    }))).resolves.toEqual({ loadPlugin: false, unloadPlugin: false, onUnload: false })
    const denied = await request.post(base + '/~/api/_pluginProbe', {
        data: {}, headers: { 'x-hfs-anti-csrf': '1' },
    })
    expect(denied.status()).toBe(403)
    const frontend = await request.get(base + '/')
    const frontendHtml = await frontend.text()
    expect(frontendHtml).toContain('frontend.js')
    expect(frontendHtml).toContain('frontend.css')
    expect(frontendHtml).not.toContain('admin.js')
    expect(frontendHtml).not.toContain('admin.css')
    const admin = await request.get(base + '/~/admin/')
    const adminHtml = await admin.text()
    expect(adminHtml).toContain('admin.css')
    expect(adminHtml).not.toContain('frontend.js')
    expect(adminHtml).not.toContain('frontend.css')

    await page.goto(base + '/~/admin/#/plugins/admin-api/probe')
    await expect(page.getByText('Plugin login extension')).toBeVisible()
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('admin')
    await page.getByLabel('Password', { exact: true }).fill('test-password')
    await expect(page.getByRole('textbox', { name: 'OTP', exact: true })).toHaveAttribute('inputmode', 'numeric')
    await page.getByRole('textbox', { name: 'OTP', exact: true }).fill('wrong')
    await page.getByRole('textbox', { name: 'OTP', exact: true }).press('Enter')
    await expect(page.getByRole('alert')).toContainText('invalid test OTP')
    await expect(page.getByText('Plugin page content')).toHaveCount(0)
    await page.getByRole('textbox', { name: 'OTP', exact: true }).fill('123456')
    await page.getByRole('button', { name: 'ctrl + enter', exact: true }).click()
    await expect(page.getByText('Plugin page content')).toBeVisible()
    await expect(page.locator('#plugin-probe')).toHaveCSS('border-top-width', '7px')
    const publicConfig = { publicPath: '/files', decoratedPath: 'decorated:/files' }
    await expect(page.evaluate(() => HFS.plugins['admin-api'])).resolves.toEqual(publicConfig)
    await expect(page.getByRole('heading', { name: 'Plugin probe', exact: true })).toBeVisible()
    await expect(page.getByTestId('plugin-title-side')).toBeVisible()
    await page.getByRole('button', { name: 'Call plugin', exact: true }).click()
    await expect(page.getByText('Plugin endpoint works')).toBeVisible()
    await expect(page.evaluate(() => HFS.customRestCall('test/hfs-probe:pluginProbe')))
        .resolves.toEqual({ message: 'Plugin endpoint works' })
    await expect(page.evaluate(() => HFS.customRestCall('admin-api:legacyProbe')))
        .resolves.toEqual({ legacy: true })
    await expect(page.evaluate(() => HFS.customRestCall('admin-api:pluginProbe')))
        .resolves.toEqual({ message: 'Plugin endpoint works' })
    await expect(page.evaluate(() => (window as any).externalPluginRestCall()))
        .resolves.toEqual({ message: 'Plugin endpoint works' })
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'admin-api-duplicate' }))
    await expect(page.evaluate(() => (window as any).pluginOwnRestCall()))
        .resolves.toEqual({ message: 'Plugin endpoint works' })
    await expect(page.evaluate(() => (window as any).pluginRestCallThroughSharedHelper()))
        .resolves.toEqual({ message: 'Plugin endpoint works' })
    await expect.poll(() => page.evaluate(() => typeof (window as any).prefixedExternalRestCall)).toBe('function')
    const prefixedResult = await page.evaluate(async () => {
        try { return { value: await (window as any).prefixedExternalRestCall() } }
        catch(error) { return { error: String(error) } }
    })
    if ('error' in prefixedResult)
        expect(prefixedResult.error).toContain('plugin ownership is ambiguous')
    else
        expect(prefixedResult.value).toEqual({ message: 'Duplicate endpoint' })
    await expect(page.evaluate(() => HFS.customRestCall('test/hfs-probe:pluginProbe').catch((error: any) => error.code)))
        .resolves.toBe(409)
    await expect(page.evaluate(() => HFS.customRestCall('admin-api:pluginProbe')))
        .resolves.toEqual({ message: 'Plugin endpoint works' })
    await page.evaluate(() => HFS.apiCall('stop_plugin', { id: 'admin-api-duplicate' }))
    await expect(page.evaluate(() => (window as any).frontendPluginLoaded)).resolves.toBeUndefined()

    const menuButton = page.getByRole('button', { name: 'menu', exact: true })
    const compactMenu = page.viewportSize()!.width < 1200
    if (compactMenu) {
        await menuButton.click()
        await page.waitForTimeout(300)
    }
    await page.getByRole('link', { name: /^Accounts/ }).click()
    if (compactMenu)
        await page.goto(base + '/~/admin/#/plugins/admin-api/probe')
    else
        await page.getByRole('link', { name: /^Plugin probe/ }).click()
    await expect(page.getByText('Plugin page content')).toBeVisible()
    await expect(page.locator('a.Mui-selected')).toHaveCount(1)
    await page.reload()
    await expect(page.getByText('Plugin page content')).toBeVisible()
    if (compactMenu)
        await page.goto(base + '/~/admin/#/plugins/installed')
    else
        await page.getByRole('link', { name: /^Plugins/ }).click()
    await page.getByRole('button', { name: 'Options', exact: true }).click()
    await expect(page.locator('#options-probe')).toHaveText('saved')
    await page.getByRole('textbox', { name: 'Probe message' }).fill('unsaved')
    await page.getByRole('button', { name: 'Test current options', exact: true }).click()
    await expect(page.getByText('Sent: unsaved', { exact: true })).toBeVisible()
    await expect(page.getByText('Sent: unsaved', { exact: true })).toBeHidden()
    await expect(page.locator('#options-probe')).toHaveText('unsaved')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    if (compactMenu)
        await page.goto(base + '/~/admin/#/plugins/admin-api/probe')
    else
        await page.getByRole('link', { name: /^Plugin probe/ }).click()
    await page.setViewportSize({ width: 700, height: 900 })
    await page.getByRole('button', { name: 'menu', exact: true }).click()
    await expect(page.getByRole('link', { name: /^Plugin probe/ })).toBeVisible()
    await expect(page.getByTestId('plugin-page-icon')).toBeVisible()
    await page.getByRole('link', { name: /^Plugins/ }).click()
    const runtimeMarker = await page.evaluate(() => (window as any).runtimeMarker = crypto.randomUUID())
    await expect(page.evaluate(() => HFS.emit('pluginBeforeOptions:admin-api', { values: {} }).length)).resolves.toBe(1)
    await page.getByRole('button', { name: 'Stop admin-api', exact: true }).click()
    await expect(page.locator('[plugin="admin-api"]')).toHaveCount(0)
    await expect(page.evaluate(() => (window as any).runtimeMarker)).resolves.toBe(runtimeMarker)
    await expect(page.evaluate(() => (window as any).pluginCleanupCalls)).resolves.toBe(1)
    await expect(page.evaluate(() => HFS.emit('pluginBeforeOptions:admin-api', { values: {} }).length)).resolves.toBe(0)
    await page.getByRole('button', { name: 'Start admin-api', exact: true }).click()
    await expect(page.locator('[plugin="admin-api"]')).toHaveCount(6)
    await expect(page.evaluate(() => (window as any).runtimeMarker)).resolves.toBe(runtimeMarker)
    await expect.poll(() => page.evaluate(() => HFS.emit('pluginBeforeOptions:admin-api', { values: {} }).length)).toBe(1)
    await expect(page.evaluate(() => HFS.plugins['admin-api'])).resolves.toEqual(publicConfig)
    await page.getByRole('button', { name: 'menu', exact: true }).click()
    await expect(page.getByRole('link', { name: /^Plugin probe/ })).toBeVisible()
})

test('shared hooks still render frontend extensions and login inputs', async ({ page }) => {
    await page.goto(base + '/')
    await expect(page.getByText('Frontend plugin extension')).toBeVisible()
    await expect(page.evaluate(() => (window as any).frontendPluginRestCall())).resolves.toEqual({ frontend: true })
    await page.locator('#login-button').click()
    await expect(page.getByPlaceholder('Frontend OTP')).toBeVisible()
    await expect(page.getByText('Plugin login extension')).toHaveCount(0)
})

test('login page receives plugins started by another Admin session', async ({ browser }) => {
    const adminContext = await browser.newContext()
    const loginContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    const loginPage = await loginContext.newPage()
    await adminPage.goto(base + '/~/admin/')
    await loginAdmin(adminPage)
    const streamConnected = loginPage.waitForResponse(response => response.url().includes('/~/api/get_admin_plugins'))
    await loginPage.goto(base + '/~/admin/')
    await streamConnected
    await expect(loginPage.getByText('Late login extension')).toHaveCount(0)
    await adminPage.evaluate(() => HFS.apiCall('start_plugin', { id: 'late-login' }))
    await expect(loginPage.getByText('Late login extension')).toBeVisible()
    await adminPage.evaluate(async () => {
        await HFS.apiCall('stop_plugin', { id: 'late-login' })
        await HFS.apiCall('start_plugin', { id: 'late-login' })
        await HFS.apiCall('stop_plugin', { id: 'late-login' })
    })
    await expect(loginPage.getByText('Late login extension')).toHaveCount(0)
    await adminContext.close()
    await loginContext.close()
})

test('a queued stop unloads a plugin whose external script is still loading', async ({ page }) => {
    await page.goto(base + '/~/admin/')
    await loginAdmin(page)
    const requested = new Promise<void>(resolve => slowScriptRequested = resolve)
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'slow-admin' }))
    await requested
    await page.evaluate(() => HFS.apiCall('stop_plugin', { id: 'slow-admin' }))
    slowScriptResponse!.end(`
window.slowAdminExecuted = (window.slowAdminExecuted || 0) + 1
HFS.onEvent('unload:', () => window.slowAdminCleaned = (window.slowAdminCleaned || 0) + 1)
HFS.admin.addPage({ id: 'slow', label: "Slow plugin", component: () => HFS.h('p', {}, "Slow page") })
`)
    slowScriptResponse = undefined
    slowScriptRequested = undefined
    await expect.poll(() => page.evaluate(() => (window as any).slowAdminCleaned)).toBe(1)
    await expect(page.getByRole('link', { name: 'Slow plugin' })).toHaveCount(0)
    await expect(page.locator('[plugin="slow-admin"]')).toHaveCount(0)
})

test('runtime loading preserves plugin dependencies', async ({ page }) => {
    await page.goto(base + '/~/admin/')
    await loginAdmin(page)
    const requested = new Promise<void>(resolve => slowScriptRequested = resolve)
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'dep-a' }))
    await requested
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'dep-b' }))
    await delay(250)
    await expect(page.evaluate(() => (window as any).depBResult)).resolves.toBeUndefined()
    await page.evaluate(() => HFS.apiCall('stop_plugin', { id: 'dep-b' }))
    slowScriptResponse!.end(`window.depHelper = () => 'ready'`)
    slowScriptResponse = undefined
    slowScriptRequested = undefined
    await delay(250)
    await expect(page.evaluate(() => (window as any).depBResult)).resolves.toBeUndefined()
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'dep-b' }))
    await expect.poll(() => page.evaluate(() => (window as any).depBResult)).toBe('ready')
    await page.evaluate(async () => {
        await HFS.apiCall('stop_plugin', { id: 'dep-b' })
        await HFS.apiCall('stop_plugin', { id: 'dep-a' })
    })
})

test('stopping a plugin cancels a child script still loading', async ({ page }) => {
    await page.goto(base + '/~/admin/')
    await loginAdmin(page)
    const requested = new Promise<void>(resolve => slowScriptRequested = resolve)
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'child-loader' }))
    await requested
    await page.evaluate(() => HFS.apiCall('stop_plugin', { id: 'child-loader' }))
    await expect(page.locator('[plugin="child-loader"]')).toHaveCount(0)
    expect(fallbackScriptRequests).toBe(0)
    slowScriptResponse!.end('window.childLateExecuted = true')
    slowScriptResponse = undefined
    slowScriptRequested = undefined
    await delay(500)
    await expect(page.evaluate(() => (window as any).childLateExecuted)).resolves.toBeUndefined()
})

test('a timed-out external script cannot execute later', async ({ page }) => {
    test.setTimeout(40_000)
    await page.goto(base + '/~/admin/')
    await loginAdmin(page)
    const requested = new Promise<void>(resolve => slowScriptRequested = resolve)
    await page.evaluate(() => HFS.apiCall('start_plugin', { id: 'slow-admin' }))
    await requested
    await expect(page.locator('[plugin="slow-admin"]')).toHaveCount(1)
    await expect(page.locator('[plugin="slow-admin"]')).toHaveCount(0, { timeout: 20_000 })
    slowScriptResponse?.end('window.slowLateExecuted = true')
    slowScriptResponse = undefined
    slowScriptRequested = undefined
    await delay(500)
    await expect(page.evaluate(() => (window as any).slowLateExecuted)).resolves.toBeUndefined()
    await page.evaluate(() => HFS.apiCall('stop_plugin', { id: 'slow-admin' }))
})

test('a missing plugin script does not prevent Admin from rendering', async ({ page }) => {
    await page.route('**/plugins/admin-api/first.js', route => route.fulfill({ status: 404, body: 'missing' }))
    await page.goto(base + '/~/admin/')
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'OTP', exact: true })).toHaveCount(0)
})

async function loginAdmin(page: import('@playwright/test').Page) {
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('admin')
    await page.getByLabel('Password', { exact: true }).fill('test-password')
    await page.getByRole('textbox', { name: 'OTP', exact: true }).fill('123456')
    await page.getByRole('button', { name: 'ctrl + enter', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveCount(0)
}
