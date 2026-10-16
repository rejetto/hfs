import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

test('plugin search fields, partial results, URL restoration, labels and ZIP', async ({ page }, info) => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'hfs-plugin-search-ui-')))
    await mkdir(join(cwd, 'files/sub'), { recursive: true })
    await writeFile(join(cwd, 'files/alpha.txt'), 'alpha')
    await writeFile(join(cwd, 'files/sub/beta.txt'), 'beta')
    await cp(resolve('e2e/fixtures/search-plugin'), join(cwd, 'plugins/renamed-search'), { recursive: true })
    for (const { id, ...field } of [
        { id: 'literal-label', label: 'Name' },
        { id: 'fallback-label', label: 'Comment', labelKey: 'fixtureSearch_missing' },
    ]) {
        await mkdir(join(cwd, 'plugins', id))
        await writeFile(join(cwd, 'plugins', id, 'plugin.js'), `
exports.apiRequired = 14
exports.init = api => api.registerSearch({ ...${JSON.stringify(field)}, prepare: () => () => true })
`)
    }
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        log: '', error_log: '', enable_plugins: ['renamed-search', 'literal-label', 'fallback-label'],
        vfs: { children: [{ name: 'files', source: join(cwd, 'files') }] },
    }))
    const child = spawn(process.execPath, [resolve('dist/src/index.js'), '--cwd', cwd, '--no-central'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
        for (let i = 0; i < 150; i++) {
            base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
            expect(child.exitCode, output).toBeNull()
            if (base && (await fetch(base + '/~/api/get_file_list?uri=/files/').then(r => r.json())).searchFields?.length === 3) break
            await delay(40)
        }
        expect(base, output).not.toBe('')
        await page.goto(base + '/files/?lang=en')
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toBeVisible()
        await page.locator('#search-button').click()
        await page.getByRole('button', { name: 'More filters', exact: true }).click()
        const group = page.getByRole('group', { name: 'Fixture search', exact: true })
        const suffix = group.getByRole('textbox', { name: 'File suffix', exact: true })
        await expect(suffix).toBeHidden()
        const spacing = await page.locator('#search-dialog form').evaluate(form => {
            const native = Array.from(form.querySelectorAll(':scope > fieldset'))
            const plugins = Array.from(form.querySelectorAll('.search-plugin-fields > fieldset'))
            const gap = (a: Element, b: Element) => b.getBoundingClientRect().top - a.getBoundingClientRect().bottom
            return { expected: gap(native[0], native[1]), actual: gap(plugins[0], plugins[1]) }
        })
        expect(spacing.actual).toBeGreaterThan(0)
        expect(spacing.actual).toBeCloseTo(spacing.expected, 0)
        await group.locator('summary').click()
        await suffix.fill('pending')
        await submit()
        await expect(page.locator('.search-partial')).toBeVisible()
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toHaveCount(0)
        await page.locator('#search-button').click()
        await expect(suffix).toBeVisible()
        await expect(suffix).toHaveValue('pending')
        await suffix.fill('alpha.txt')
        const literal = page.getByRole('group', { name: 'Name', exact: true })
        await literal.locator('summary').click()
        await literal.getByRole('textbox').fill('literal value')
        await submit()
        await expect.poll(() => new URL(page.url()).searchParams.get('searchPlugin.literal-label')).toBe('literal value')
        const params = new URL(page.url()).searchParams
        expect(JSON.parse(params.get('searchPlugins')!)).toEqual({ 'renamed-search': { suffix: 'alpha.txt' } })
        expect(params.get('searchPlugin.literal-label')).toBe('literal value')
        await expect(page.locator('.search-partial')).toHaveCount(0)
        await expect(page.getByRole('link', { name: 'alpha.txt', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'beta.txt', exact: true })).toHaveCount(0)
        await page.reload()
        await settled()
        await page.locator('#search-button').click()
        await expect(suffix).toBeVisible()
        await expect(suffix).toHaveValue('alpha.txt')
        await expect(literal.getByRole('textbox')).toHaveValue('literal value')
        await submit()
        const zip = await page.locator('#zip-button').getAttribute('href')
        const response = await page.request.get(new URL(zip!, base + '/files/').href)
        expect(response.ok()).toBe(true)
        const { Open } = await import('unzipper')
        expect((await Open.buffer(await response.body())).files.map(file => file.path)).toEqual(['alpha.txt'])
        await page.goto(base + '/files/?' + new URLSearchParams({ lang: 'it',
            pluginSearch: JSON.stringify({ 'renamed-search': { suffix: 'alpha.txt' }, 'literal-label': 'test', 'fallback-label': 'test' }),
        }))
        await settled()
        await expect(page.locator('#searched')).toContainText('Ricerca fixture')
        await expect(page.locator('#searched')).toContainText('Name')
        await expect(page.locator('#searched')).toContainText('Comment')
        await page.locator('#search-button').click()
        await expect(page.getByRole('group', { name: 'Ricerca fixture', exact: true }).getByRole('textbox')).toHaveValue('alpha.txt')
        await expect(literal.getByRole('textbox')).toHaveValue('test')
        await expect(page.getByRole('group', { name: 'Comment', exact: true }).getByRole('textbox')).toHaveValue('test')
        await submit('Continua')
        await page.locator('#search-clear-button').click()
        await settled()
        const cleared = new URL(page.url()).searchParams
        expect([...cleared.keys()].filter(key => key.startsWith('searchPlugin'))).toEqual([])
        expect(errors).toEqual([])
    }
    finally {
        await info.attach('server-output', { body: output, contentType: 'text/plain' })
        await page.close()
        child.kill()
        await exited
        await rm(cwd, { recursive: true, force: true })
    }

    async function submit(name = 'Continue') {
        await page.getByRole('button', { name, exact: true }).click()
        await expect(page.locator('#search-dialog')).toHaveCount(0)
        await settled()
    }

    async function settled() {
        await expect.poll(() => page.evaluate(() => (window as any).HFS.state.loading)).toBe(false)
    }
})
