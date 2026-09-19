import test from 'node:test'
import assert from 'node:assert/strict'
import { updateChangelog } from '../src/updateChangelog'
import type { Release } from '../src/update'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import _ from 'lodash'

test('update changelog selects major/minor releases and deduplicates patch entries', () => {
    const destination = release('3.4.4', '- bug fixes')
    const history = [
        release('3.2.0', '- already installed'),
        release('3.3.0', '- first feature'),
        release('3.4.0', '- second feature'),
        release('3.4.3', '- bug fixes\n- specific fix\n  with details'),
        release('3.5.0', '- future feature'),
        { ...release('3.4.1', '- beta feature'), prerelease: true },
    ]
    assert.equal(updateChangelog(destination, history, 3_002_000),
        '**v3.4.0**\n\n- second feature\n\n**v3.3.0**\n\n- first feature')
    assert.equal(updateChangelog(destination, history, 3_004_000),
        '- bug fixes\n\n**v3.4.3**\n\n- specific fix\n  with details')
    assert.equal(updateChangelog(release('4.1.1', '- bug fixes'), [...history, release('4.0.0', '- major feature')], 3_002_000),
        '**v4.0.0**\n\n- major feature')
    assert.equal(updateChangelog(destination, [release('3.4.3', '* bug fixes\r\n')], 3_004_000),
        '- bug fixes')
    assert.equal(updateChangelog(destination, [], 3_002_000), '- bug fixes')
    assert.equal(updateChangelog(destination, [release('3.4.3', '')], 3_004_000), '- bug fixes')

    function release(version: string, body: string): Release {
        const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
        return { tag_name: 'v' + version, name: version, body, prerelease: false, assets: [], isNewer: true,
            versionScalar: major * 1E6 + minor * 1E3 + patch }
    }
})


test('update history stops at the installed release without stopping at a newer maintenance release', async () => {
    const source = ts.createSourceFile('update.ts', readFileSync(resolve(__dirname, '../src/update.ts'), 'utf8'), ts.ScriptTarget.Latest)
    // isolate the actual update lookup from startup timers and network calls
    const names = ['prepareRelease', 'getVersions', 'getUpdates', 'ReleaseKeys', 'ReleaseAssetKeys']
    const code = source.statements.filter(s => ts.isFunctionDeclaration(s) ? names.includes(s.name!.text)
        : ts.isVariableStatement(s) && s.declarationList.declarations.some(d => names.includes(d.name.getText(source))))
        .map(s => s.getText(source)).join('\n')
    const { outputText } = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    const releases = ['3.4.4', '3.3.10', '3.4.2', '3.4.1', '3.3.0'].map(name => ({
        name, tag_name: 'v' + name, body: '- changes in ' + name, assets: [], prerelease: false,
    }))
    let visited = 0
    let closed = false
    const exported: Partial<typeof import('../src/update')> = {}
    runInNewContext(outputText, {
        exports: exported, _, curV: 3_004_001, HFS_REPO: 'rejetto/hfs', RUNNING_BETA: false,
        updateToBeta: { get: () => false }, getProjectInfo() {}, console: { log() {} }, updateChangelog,
        getRepoInfo: async () => releases[0],
        versionToScalar: (v: string) => v.split('.').reduce((total, n) => total * 1000 + Number(n), 0),
        apiGithubPaginated: async function* () {
            try {
                for (const release of releases) {
                    visited++
                    yield release
                }
            }
            finally { closed = true }
        },
    })
    const updates = await exported.getUpdates!()
    assert.equal(visited, 4)
    assert.equal(closed, true)
    assert.equal(updates[0]?.body, '- changes in 3.4.4\n\n**v3.4.2**\n\n- changes in 3.4.2')
    visited = 0
    await exported.getVersions!()
    assert.equal(visited, releases.length, 'other release listings must still include older versions')
})
