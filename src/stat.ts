import { Worker } from 'node:worker_threads'
import { Stats } from 'node:fs'
import { PendingPromise, pendingPromise } from './cross'

// all stat requests for the same worker are serialized, potentially introducing extra latency

const pool = new Map<string, (path: string) => Promise<Stats>>()

export function getStatWorker(key: string) {
    const existing = pool.get(key)
    if (existing)
        return existing
    const worker = new Worker(__dirname + '/statWorker.js')
    worker.unref()
    const requests = new Map<string, PendingPromise<Stats>>()
    worker.on('message', (msg: any) => { // request finished, good or bad
        const k = msg.path
        requests.get(k)?.resolve(msg.error ? Promise.reject(new Error(msg.error))
            : Object.setPrototypeOf(msg.result, Stats.prototype) )
        requests.delete(k)
    })
    worker.on('error', (err) => { // worker failure
        for (const p of requests.values())
            p.reject(err)
        requests.clear()
        worker.terminate().catch(() => {})
        pool.delete(key)
    })
    pool.set(key, query)
    return query

    function query(path: string) {
        const was = requests.get(path)
        if (was)
            return was
        const ret = pendingPromise<Stats>()
        requests.set(path, ret)
        worker.postMessage(path)
        return ret
    }
}
