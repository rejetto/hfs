import { KvStorage } from '@rejetto/kvstorage'
import { MINUTE } from './misc'
import { onProcessExit } from './first'
import glob from 'fast-glob'
import { unlink } from 'fs/promises'

export const storedMap = new KvStorage({
    defaultPutDelay: 5000,
    maxPutDelay: MINUTE,
    maxPutDelayCreate: 1000,
    rewriteLater: true,
    bucketThreshold: 10_000,
})
storedMap.open('data.kv').catch(e => {
    console.error("Persistence won't work correctly", e)
}).finally(async () => {
    for (const x of await glob('*.kv.lock')) // legacy pre 3.0.5
        unlink(x).catch(() => {})
})
onProcessExit(() => storedMap.close())
