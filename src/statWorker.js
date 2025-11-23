const { parentPort } = require('node:worker_threads')
const { statSync } = require('node:fs')

parentPort.on('message', async path => {
    try { // we use statSync to not use (and not risk to saturate) libuv's thread pool
        parentPort.postMessage({ path, result: { ...statSync(path) } })
    } catch (err) {
        parentPort.postMessage({ path, error: err?.message || String(err) })
    }
})
