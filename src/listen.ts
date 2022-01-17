import { Server } from 'http'
import { getConfig, subscribeConfig } from './config'
import open from 'open'
import { app } from './index'

let srv: Server
let firstTime = true
subscribeConfig({ k:'port', defaultValue: 80 }, async (port: number) => {
    await new Promise(resolve => {
        if (!srv)
            return resolve(null)
        srv.close(err => {
            if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING')
                console.debug('failed to stop server', String(err))
            resolve(err)
        })
    })
    await new Promise(resolve => {
        try {
            srv = app.listen(port, () => {
                console.log('running on port', port)
                if (firstTime && getConfig('open_browser_at_start') !== false)
                    open('http://localhost:'+port)
                firstTime = false
                resolve(null)
            }).on('error', e => {
                const { code } = e as any
                if (code === 'EADDRINUSE')
                    console.error(`couldn't listen on busy port ${port}`)
            })
        }
        catch(e) {
            console.error("couldn't listen on port", port, String(e))
        }

    })
})
