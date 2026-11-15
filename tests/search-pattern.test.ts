import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { makeSearchMatcher, pattern2filter } from '../src/searchPattern'
import { makeMatcher } from '../src/cross'

test('a lone search wildcard keeps its matching rules with no regex timeout budget', () => {
    const filter = pattern2filter('*', { remaining: 0 })
    const expected = makeMatcher('*', false, false)
    for (const name of ['file.txt', '.hidden', '', 'é'])
        assert.equal(filter(name), expected(name), name)
})

test('guarded searches charge matching time against their shared budget', () => {
    const budget = { remaining: Number.MIN_VALUE }
    const filter = pattern2filter('file?', budget)
    assert.throws(() => filter('file1'), /total matching time limit/)
    assert.ok(budget.remaining <= 0)
})

test('search wildcard normalization preserves the existing matcher grammar', () => {
    const patterns = ['*', '?*', '*?*?*', '.*?*', 'a*?*b', '*?*.txt', '*?*|report*', '!*.mp3',
        '{report,bar}*', 'file[0-9]*', '[ab]*?*', '[[:alpha:]]*?*', '(ab)+Z*', 'a+b*',
        'literal\\+name', '"*?"*', '\\**?*', '(?=a)a*?*', '(?:a|b)*?*', '(a*?*|b*)',
        '(*?*', '{a,*?*', '[*?*', 'é*?*', 'Σ*?*', 'k*?*', '*?*/tail', '*?*\n', '*?+', 'a*?+b', '*\\\\*']
    const values = ['', '.', '..', '.a', '.ab', 'a', 'ab', 'aaab', 'b', 'ababZtail',
        'REPORT.pdf', 'BAR.txt', 'FILE2.txt', 'audio.MP3', 'literal+name', '*?', 'a*b',
        'Éab', 'σab', 'ςab', 'Kab', 'Kab', 'a\nb', 'ab\n', '[ab]', 'a/tail', 'a\\b']
    for (const pattern of patterns) {
        const expected = makeMatcher(pattern, false, false), actual = makeSearchMatcher(pattern)
        for (const value of values)
            assert.equal(actual(value), expected(value), JSON.stringify({ pattern, value }))
    }
    const normalized = makeSearchMatcher('*?'.repeat(9) + 'z')
    assert.equal(normalized('a'.repeat(64)), false)
    assert.equal(normalized('a'.repeat(64) + 'z'), true)
})

test('search preserves wildcard syntax and interrupts expensive JSON, SSE and ZIP filters', { timeout: 30000 }, async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-search-pattern-'))
    const normal = join(cwd, 'normal'), slow = join(cwd, 'slow')
    await mkdir(normal)
    await mkdir(slow)
    const names = ['REPORT.pdf', 'BAR.txt', 'FILE2.txt', 'audio.wav', 'audio.MP3', 'audio2mp3', 'ababZtail', 'aaabtail', 'literal+name']
    await Promise.all(names.map(name => writeFile(join(normal, name), name)))
    const longName = 'a'.repeat(64)
    await writeFile(join(slow, longName), 'content')
    await writeFile(join(slow, 'descript.ion'), longName + ' ' + longName + '\n')
    await writeFile(join(cwd, 'large-source'), 'content')
    await writeFile(join(cwd, 'descript.ion'), 'large-source ' + 'a'.repeat(16) + '\n')
    await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1', open_browser_at_start: false,
        enable_plugins: [], log: '', error_log: '', upnp: false, auto_check_update: false,
        vfs: { children: [{ name: 'normal', source: normal }, { name: 'slow', source: slow },
            { name: 'large', children: Array.from({ length: 10000 }, (_, i) => ({
                name: 'a'.repeat(16) + i, source: join(cwd, 'large-source'),
            })) }] },
    }))
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--cwd', cwd, '--no-central'], {
        cwd: resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stopped = once(child, 'exit')
    // an external deadline also bounds a regression that stops the server's event loop
    const deadline = setTimeout(() => child.kill('SIGKILL'), 20000)
    let output = '', base = ''
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    t.after(async () => {
        clearTimeout(deadline)
        child.kill('SIGKILL')
        await stopped
        await rm(cwd, { recursive: true, force: true })
    })
    for (let i = 0; i < 200 && !base; i++) {
        assert.equal(child.exitCode, null, output)
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] || ''
        if (!base) await delay(50)
    }
    assert.ok(base, output)
    const controls = [
        ['report', ['REPORT.pdf']],
        ['report.pdf', ['REPORT.pdf']],
        ['*mp3', ['audio.MP3', 'audio2mp3']],
        ['*.mp3', ['audio.MP3']],
        ['audio*', ['audio.MP3', 'audio2mp3', 'audio.wav']],
        ['audio.*', ['audio.MP3', 'audio.wav']],
        ['report|bar', ['REPORT.pdf', 'BAR.txt']],
        ['{report,bar}*', ['REPORT.pdf', 'BAR.txt']],
        ['file[0-9]*', ['FILE2.txt']],
        ['!*.mp3', names.filter(name => name !== 'audio.MP3')],
        ['file?.txt', ['FILE2.txt']],
        ['(ab)+Z*', ['ababZtail']],
        ['a+b*', ['ababZtail', 'aaabtail']],
        ['literal\\+name', ['literal+name']],
        ['', names],
    ] as const
    for (const [search, expected] of controls) {
        const response = await list({ uri: '/normal/', search })
        assert.equal(response.status, 200, await response.clone().text())
        const body = await response.json()
        assert.deepEqual(body.list.map((entry: { n: string }) => entry.n).sort(), [...expected].sort(), search)
    }
    const combined = await list({ uri: '/normal/', search: 'file?', fileMask: '*.txt' })
    assert.deepEqual((await combined.json()).list.map((entry: { n: string }) => entry.n), ['FILE2.txt'])
    const large = await list({ uri: '/large/', search: '*' })
    assert.equal(large.status, 200, await large.clone().text())
    assert.equal((await large.json()).list.length, 10000, 'cheap matching does not charge VM setup against the budget')
    const flat = '*?'.repeat(9) + 'z'
    const grouped = '(a+)+z*'
    // under load the per-match watchdog can fire before the cumulative budget runs out
    const matchingTimeError = /total matching time limit|Search pattern takes too long to evaluate/
    for (const field of ['search', 'fileMask', 'searchComment']) {
        const cumulative = await list({ uri: '/large/', [field]: grouped })
        assert.equal(cumulative.status, 400, await cumulative.clone().text())
        assert.match(await cumulative.text(), matchingTimeError)
    }
    const combinedBudget = await list({ uri: '/large/', search: '!' + grouped,
        fileMask: '!' + grouped, searchComment: '!' + grouped })
    assert.equal(combinedBudget.status, 400, await combinedBudget.clone().text())
    assert.match(await combinedBudget.text(), matchingTimeError)
    for (const field of ['search', 'fileMask', 'searchComment']) {
        const response = await list({ uri: '/slow/', [field]: flat })
        assert.equal(response.status, 200, await response.clone().text())
        assert.deepEqual((await response.json()).list, [])
    }
    for (const [field, pattern] of [['search', grouped], ['fileMask', grouped], ['searchComment', grouped]]) {
        const response = await list({ uri: '/slow/', [field]: pattern })
        assert.equal(response.status, 400, field + ': ' + await response.clone().text())
        assert.match(await response.text(), /Search pattern takes too long/)
    }
    const literal = await list({ uri: '/slow/', search: flat, wild: 'no' })
    assert.equal(literal.status, 200)
    assert.deepEqual((await literal.json()).list, [])
    const sse = await list({ uri: '/slow/', search: grouped }, { accept: 'text/event-stream' })
    assert.equal(sse.status, 200)
    assert.match(await sse.text(), /Search pattern takes too long/)
    const cumulativeSse = await list({ uri: '/large/', search: grouped }, { accept: 'text/event-stream' })
    assert.equal(cumulativeSse.status, 200)
    assert.match(await cumulativeSse.text(), matchingTimeError)
    const start = performance.now()
    const [rejected, ordinary] = await Promise.all([
        list({ uri: '/slow/', search: grouped }),
        list({ uri: '/normal/' }),
    ])
    assert.equal(rejected.status, 400)
    assert.equal(ordinary.status, 200)
    assert.ok(performance.now() - start < 2000, 'ordinary requests remain responsive')
    const zipQuery = new URLSearchParams({ get: 'zip', search: grouped })
    const early = await send('/slow/?' + zipQuery)
    assert.equal(early.status, 400, await early.text())
    const cumulativeEarly = await send('/large/?' + zipQuery)
    assert.equal(cumulativeEarly.status, 400, await cumulativeEarly.text())
    const config = await send('/~/api/set_config', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
        body: JSON.stringify({ values: { zip_calculate_size_for_seconds: 0 } }),
    })
    assert.equal(config.status, 200, await config.text())
    const late = await send('/slow/?' + zipQuery).then(async response => ({
        status: response.status, complete: await response.arrayBuffer().then(() => true, () => false),
    }), () => ({ status: 0, complete: false }))
    assert.ok(late.status === 400 || !late.complete, 'a late timeout rejects or aborts the archive')
    const cumulativeLate = await send('/large/?' + zipQuery).then(async response => ({
        status: response.status, complete: await response.arrayBuffer().then(() => true, () => false),
    }), () => ({ status: 0, complete: false }))
    assert.ok(cumulativeLate.status === 400 || !cumulativeLate.complete, 'a late total budget rejects or aborts the archive')
    assert.equal((await list({ uri: '/normal/' })).status, 200)
    assert.doesNotMatch(output, /unhandledRejection|UnhandledPromiseRejection/)

    function list(params: Record<string, string>, headers?: Record<string, string>) {
        return send('/~/api/get_file_list?' + new URLSearchParams(params), { headers })
    }

    function send(path: string, init: RequestInit = {}) {
        // leave room for virtual filesystem I/O in the 10,000-entry fixture
        return fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) })
    }
})
