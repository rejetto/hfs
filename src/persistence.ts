import { KvStorage } from '@rejetto/kvstorage'
import { MINUTE, onProcessExit } from './misc'

export const storedMap = new KvStorage({
    defaultPutDelay: 5000,
    maxPutDelay: MINUTE,
    maxPutDelayCreate: 1000,
    rewriteLater: true
})
storedMap.open('data.kv')
onProcessExit(() => storedMap.flush())
