import { Worker } from 'node:worker_threads'
import { Stats } from 'node:fs'
import { pendingPromise } from './cross'

// all stat requests for the same worker are serialized, potentially introducing extra latency

const pool = new Map<string, (path: string) => Promise<Stats>>()

export function getStatWorker(key: string) {
    const existing = pool.get(key)
    if (existing)
        return existing
    const worker = new Worker(__dirname + '/statWorker.js')
    worker.unref()
    const requests = new Map()
    worker.on('message', (msg: any) => {
        requests.get(msg.path)?.resolve(msg.error
            ? Promise.reject(new Error(msg.error))
            : Object.setPrototypeOf(msg.result, Stats.prototype)
        )
        requests.delete(msg.path)
    })
    worker.on('error', (err) => {
        for (const p of requests.values())
            p.reject(err)
        requests.clear()
        worker.terminate().catch(() => {})
        pool.delete(key)
    })
    pool.set(key, query)
    return query

    function query(path: string) {
        const ret = pendingPromise<Stats>()
        requests.set(path, ret)
        worker.postMessage(path)
        return ret
    }
}
