import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('plugins.versionRequired checks source, startup and online compatibility', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'hfs-plugin-version-'))
    try {
        await writeFile(join(cwd, 'config.yaml'), JSON.stringify({
            port: -1, enable_plugins: [], open_browser_at_start: false, log: '', error_log: '',
        }))
        // plugins imports the server; isolate startup and plugin files from the test runner
        await promisify(execFile)(process.execPath, ['-e', `
            process.argv = [process.execPath, 'test', '--cwd', ${JSON.stringify(cwd)}, '--no-central']
            const assert = require('node:assert/strict')
            const { mkdir, writeFile } = require('node:fs/promises')
            const { createServer } = require('node:http')
            require(${JSON.stringify(resolve('dist/src'))})
            const { configReady } = require(${JSON.stringify(resolve('dist/src/config'))})
            const { VERSION, API_VERSION, RUNNING_BETA } = require(${JSON.stringify(resolve('dist/src/const'))})
            const { parsePluginSource, rescan, getPluginInfo, startPlugin, isPluginRunning } =
                require(${JSON.stringify(resolve('dist/src/plugins'))})
            const { waitFor } = require(${JSON.stringify(resolve('dist/src/cross'))})
            ;(async () => {
                await configReady
                const server = createServer((req, res) => res.end(source({
                    versionRequired: req.url === '/range.js' ? [VERSION, VERSION] : VERSION,
                })))
                await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
                const repo = { main: 'http://127.0.0.1:' + server.address().port + '/plugin.js' }
                const rangeRepo = { main: 'http://127.0.0.1:' + server.address().port + '/range.js' }
                const cases = [
                    ['current', { versionRequired: VERSION, repo }, true],
                    ['older', { versionRequired: '0.1.0' }, true],
                    ['future', { versionRequired: '999.0.0' }, false],
                    ['stable', { versionRequired: VERSION.split('-')[0] }, !RUNNING_BETA],
                    ['both', { versionRequired: VERSION, apiRequired: API_VERSION }, true],
                    ['api-future', { versionRequired: VERSION, apiRequired: API_VERSION + 1 }, false],
                    ['api-max', { versionRequired: VERSION, apiRequired: [1, API_VERSION - 1] }, false],
                    ['version-future', { versionRequired: '999.0.0', apiRequired: 1 }, false],
                    ['api-only', { apiRequired: 1 }, true],
                    ['missing', {}, false],
                    ['invalid', { versionRequired: 'wrong', apiRequired: 1 }, false],
                    ['range-exact', { versionRequired: [VERSION, VERSION], repo: rangeRepo }, true],
                    ['range', { versionRequired: ['0.1.0', '999.0.0'] }, true],
                    ['range-min', { versionRequired: ['999.0.0', '999.1.0'] }, false],
                    ['range-max', { versionRequired: ['0.1.0', '0.2.0'], apiRequired: 1 }, false],
                    ['range-empty', { versionRequired: [], apiRequired: 1 }, false],
                    ['range-short', { versionRequired: [VERSION], apiRequired: 1 }, false],
                    ['range-long', { versionRequired: [VERSION, VERSION, VERSION], apiRequired: 1 }, false],
                    ['range-invalid', { versionRequired: [VERSION, 'wrong'], apiRequired: 1 }, false],
                    ['range-type', { versionRequired: [1, VERSION], apiRequired: 1 }, false],
                ]
                if (RUNNING_BETA) {
                    const nextBeta = VERSION.replace(/[0-9]+$/, n => String(Number(n) + 1))
                    cases.push(['next-beta', { versionRequired: nextBeta }, false])
                    cases.push(['range-next-beta', { versionRequired: [nextBeta, VERSION.split('-')[0]] }, false])
                }
                const source = props => Object.entries({ description: 'compatibility probe', ...props }).map(([k, v]) =>
                    'exports.' + k + ' = ' + JSON.stringify(v)).join('\\n')
                for (const [id, props, compatible] of cases) {
                    const text = source(props)
                    const parsed = parsePluginSource(id, text)
                    assert.equal(!parsed.badApi, compatible, id + ': source')
                    assert.deepEqual(parsed.versionRequired, props.versionRequired)
                    await mkdir('plugins/' + id, { recursive: true })
                    await writeFile('plugins/' + id + '/plugin.js', text)
                }
                await rescan()
                assert.ok(await waitFor(() => cases.every(([id]) => getPluginInfo(id)), { timeout: 3000 }),
                    'missing plugins: ' + cases.filter(([id]) => !getPluginInfo(id)).map(([id]) => id))
                for (const [id, props, compatible] of cases) {
                    if (compatible) await startPlugin(id)
                    else await assert.rejects(startPlugin(id), /mandatory|newer|older|invalid/)
                    assert.equal(isPluginRunning(id), compatible, id + ': startup')
                }
                const { readOnlineCompatiblePlugin } = require(${JSON.stringify(resolve('dist/src/github'))})
                assert.equal((await readOnlineCompatiblePlugin(getPluginInfo('current').repo)).versionRequired, VERSION)
                assert.deepEqual((await readOnlineCompatiblePlugin(getPluginInfo('range-exact').repo)).versionRequired, [VERSION, VERSION])
                process.exit(0)
            })().catch(e => { console.error(e); process.exit(1) })
        `], { cwd, encoding: 'utf8', timeout: 15_000 })
    }
    finally {
        await rm(cwd, { recursive: true, force: true })
    }
})
