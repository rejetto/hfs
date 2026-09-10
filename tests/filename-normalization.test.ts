import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFilenameForPlatform } from '../src/cross'

for (const platform of ['linux', 'win32', 'darwin']) {
    test(`filename case matching on ${platform}`, () => {
        assert.equal(normalizeFilenameForPlatform('Report.txt', platform), platform === 'linux' ? 'Report.txt' : 'report.txt')
    })
    test(`filename Unicode matching on ${platform}`, () => {
        const composed = 'caf\u00e9.txt'
        const decomposed = 'cafe\u0301.txt'
        assert.equal(normalizeFilenameForPlatform(composed, platform) === normalizeFilenameForPlatform(decomposed, platform), platform === 'darwin')
    })
}
