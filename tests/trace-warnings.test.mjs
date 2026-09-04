import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('warning stacks are enabled by default with an HFS opt-out and no duplicate console records', () => {
    for (const mode of ['default', 'hfs', 'node', 'opt-out', 'node-opt-out']) {
        const result = spawnSync(process.execPath, [
            ...mode.startsWith('node') ? ['--trace-warnings'] : [],
            '--import', 'tsx', '-e', `
                const { consoleLog } = require('./src/consoleLog.ts')
                function emitProbes() {
                    process.emitWarning('hfs-warning-probe')
                    process.emitWarning('hfs-warning-probe-deprecated', 'DeprecationWarning')
                }
                emitProbes()
                setImmediate(() => process.stdout.write(JSON.stringify(
                    consoleLog.filter(x => x.msg.includes('hfs-warning-probe')))))
            `, '--', 'hfs', ...mode === 'hfs' ? ['--trace-warnings'] : mode.endsWith('opt-out') ? ['--no-trace-warnings'] : [],
        ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        const records = JSON.parse(result.stdout)
        assert.equal(records.length, 2, mode)
        for (const record of records)
            assert.equal(record.msg.includes('at emitProbes'), !mode.endsWith('opt-out'), mode)
    }
})
