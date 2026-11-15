import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

test('uploaded XML MIME types require approval for inline serving', { timeout: 30000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-xml-approval-'))
    const share = join(cwd, 'share')
    const body = '<html xmlns="http://www.w3.org/1999/xhtml"><p>uploaded</p></html>'
    const admin = { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') }
    const cases = [
        { name: 'automatic.xml', active: true },
        { name: 'published.xml', sourceName: 'document.unmapped', active: true },
        { name: 'text.custom', mime: 'text/xml', active: true },
        { name: 'parameters.custom', mime: ' Application/XML \t; charset=utf-8', active: true },
        { name: 'feed.custom', mime: 'application/atom+xml', active: true },
        { name: 'suffix.custom', mime: 'text/example+xml', active: true },
        { name: 'shorthand.custom', mime: 'xml', active: true },
        { name: 'koa-shorthand.custom', mime: 'aml', active: true },
        { name: 'html.custom', mime: 'html', active: true },
        { name: 'svg.custom', mime: 'image/svg+xml', active: true },
        { name: 'plain.xml', mime: 'text/plain', active: false },
        { name: 'json.custom', mime: 'application/example+json', active: false },
        { name: 'not-xml.custom', mime: 'application/xml-other', active: false },
        { name: 'unknown.custom', active: false },
        { name: 'global.custom', active: true },
        { name: 'mapped.custom', mime: { '*': 'text/xml' }, active: true },
    ]
    await mkdir(share)
    await writeFile(join(share, 'local.xml'), body)
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', localhost_admin: false,
        open_browser_at_start: false, enable_plugins: [], log: '', error_log: '', min_available_mb: 0,
        show_uploader: true, accounts: { admin: { password: 'secret', admin: true } },
        mime: { 'global.custom': 'application/xml' },
        vfs: { source: share, can_upload: true,
            children: cases.filter(x => x.mime || x.sourceName)
                .map(({ name, mime, sourceName }) => ({ name, source: join(share, sourceName || name), mime })) },
    }))
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--cwd', cwd, '--no-central'], {
        cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    t.after(async () => {
        child.kill('SIGKILL')
        await stopped
        await rm(cwd, { recursive: true, force: true })
    })
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    for (let i = 0; i < 300 && !base; i++) {
        assert.equal(child.exitCode, null, output)
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        if (!base) await delay(50)
    }
    assert.ok(base, output)
    assert.equal(await (await send('/local.xml')).text(), body)
    for (const { name, active, sourceName } of cases) {
        await t.test(name, async () => {
            const uri = '/' + name
            assert.equal((await send('/' + (sourceName || name), { method: 'PUT', body })).status, 200)
            const inline = await send(uri)
            assert.equal(inline.status, active ? 403 : 200)
            assert.equal((await send(uri, { method: 'HEAD' })).status, active ? 403 : 200)
            const download = await send(uri + '?dl')
            assert.equal(download.status, 200)
            assert.match(download.headers.get('content-disposition') || '', /^attachment;/)
            assert.equal(await download.text(), body)
            const details = await api('get_file_details', { uris: [uri] })
            assert.equal(details.details[0].activeContent, active)
            assert.equal(details.details[0].upload.approved, false)
            if (active) {
                assert.equal((await send('/~/api/set_upload_approved', {
                    method: 'POST', headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
                    body: JSON.stringify({ uri, approved: true }),
                })).status, 401)
                await api('set_upload_approved', { uri, approved: true })
                assert.equal(await (await send(uri)).text(), body)
                await api('set_upload_approved', { uri, approved: false })
                assert.equal((await send(uri)).status, 403)
            }
        })
    }
    await api('set_config', { values: { require_upload_approval_for_active_content: false } })
    assert.equal(await (await send('/automatic.xml')).text(), body)
    await api('set_config', { values: { require_upload_approval_for_active_content: true } })
    assert.equal((await send('/automatic.xml')).status, 403)
    assert.equal((await send('/admin.xml', { method: 'PUT', body, headers: admin })).status, 200)
    assert.equal(await (await send('/admin.xml')).text(), body)
    const details = await api('get_file_details', { uris: ['/admin.xml'] })
    assert.equal(details.details[0].upload.approved, true)

    function send(path: string, init: RequestInit={}) {
        return fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) })
    }

    async function api(name: string, params: object) {
        const response = await send('/~/api/' + name, {
            method: 'POST', headers: { ...admin, 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
            body: JSON.stringify(params),
        })
        assert.equal(response.status, 200, await response.clone().text())
        assert.match(response.headers.get('content-type') || '', /^application\/json(?:;|$)/)
        return response.json()
    }
})
