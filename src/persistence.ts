import { KvStorage } from '@rejetto/kvstorage'
import { MINUTE } from './misc'
import { onProcessExit } from './first'

export const storedMap = new KvStorage({
    defaultPutDelay: 5000,
    maxPutDelay: MINUTE,
    maxPutDelayCreate: 1000,
    rewriteLater: true,
    bucketThreshold: 10_000,
})
storedMap.open('data.kv')
onProcessExit(() => storedMap.flush())
