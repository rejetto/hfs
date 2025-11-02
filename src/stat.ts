import { defineConfig } from './config'
import { Stats } from 'node:fs'
import { haveTimeout, pendingPromise } from './cross'
import { stat } from 'fs/promises'

const fileTimeout = defineConfig('file_timeout', 3, x => x * 1000)

// since nodejs' UV_THREADPOOL_SIZE is limited, avoid using multiple slots for the same UNC host, and always leave one free for local operations
const poolSize = Number(process.env.UV_THREADPOOL_SIZE || 4)
const previous = new Map<string, Promise<Stats>>() // wrapped promises with haveTimeout
const working = new Set<Promise<Stats>>() // plain stat's promise
export async function statWithTimeout(path: string) {
    const uncHost = /^\\\\([^\\]+)\\/.exec(path)?.[1]
    if (!uncHost)
        return haveTimeout(fileTimeout.compiled(), stat(path))
    const busy = process.env.HFS_PARALLEL_UNC ? null : previous.get(uncHost) // by default we serialize requests on the same UNC host, to keep threadpool usage low
    const ret = pendingPromise<Stats>()
    previous.set(uncHost, ret) // reserve the slot before starting the operation
    const err = await busy?.then(() => false, e => e.message === 'timeout' && e) // only timeout error is shared with pending requests
    if (err) {
        if (previous.get(uncHost) === ret) // but we don't want to block forever, only involve those that were already waiting
            previous.delete(uncHost)
        ret.reject(err)
        return ret
    }
    while (working.size >= poolSize - 1) // always leave one slot free for local operations
        await Promise.race(working.values()).catch(() => {}) // we are assuming UV_THREADPOOL_SIZE > 1, otherwise race() will deadlock
    const op = stat(path)
    working.add(op)
    try {
        ret.resolve(await haveTimeout(fileTimeout.compiled(),
            op.finally(() => working.delete(op)) ))
    }
    catch (e) {
        ret.reject(e)
    }
    finally {
        if (previous.get(uncHost) === ret)
            previous.delete(uncHost)
    }
    return ret
}
