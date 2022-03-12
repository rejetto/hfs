// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import * as http from 'http'
import { defineConfig, getConfig, subscribeConfig } from './config'
import { adminApp, frontendApp } from './index'
import * as https from 'https'
import { watchLoad } from './watchLoad'
import { networkInterfaces } from 'os';
import { newConnection } from './connections'
import open from 'open'
import { debounceAsync, prefix } from './misc'
import { DEV } from './const'
import findProcess from 'find-process'
import _ from 'lodash'

interface ServerExtra { error?: string, busy?: string }
let httpSrv: http.Server & ServerExtra
let httpsSrv: http.Server & ServerExtra
let adminSrv: http.Server & ServerExtra

subscribeConfig<number>({ k:'port', defaultValue: 80 }, async port => {
    await stopServer(httpSrv)
    httpSrv = http.createServer(frontendApp.callback())
    port = await startServer(httpSrv, { port, name:'http' })
    if (!port) return
    httpSrv.on('connection', newConnection)
    printUrls(port, 'http')
})

const considerAdmin = debounceAsync(async () => {
    const port = getConfig('admin_port')
    const net = getConfig('admin_network')
    const ad = adminSrv?.address()
    if (ad && typeof ad !== 'string'
        && ad.port === port && ad.address === net) return
    await stopServer(adminSrv)
    adminSrv = http.createServer(adminApp.callback())
    const resultPort = await startServer(adminSrv, {
        port ,
        name: 'admin',
        net,
    })
    if (!resultPort)
        return
    if (getConfig('open_browser_at_start'))
        open('http://localhost:' + resultPort).then()
    console.log('admin interface on http://localhost:' + resultPort)
})

defineConfig('open_browser_at_start', { defaultValue: !DEV })

subscribeConfig<string>({ k:'admin_network', defaultValue: '127.0.0.1' }, considerAdmin)
subscribeConfig<number>({ k:'admin_port', defaultValue: 63636 }, considerAdmin)

const httpsNeeds = { cert:'', private_key:'' }
const httpsNeedsNames = { cert: 'certificate', private_key: 'private key' }
for (const k of Object.keys(httpsNeeds) as (keyof typeof httpsNeeds)[]) { // please be smarter typescript
    let unwatch: ReturnType<typeof watchLoad>['unwatch']
    subscribeConfig({ k }, async (v: string) => {
        unwatch?.()
        httpsNeeds[k] = v
        if (!v || v.includes('\n'))
            return considerHttps()
        // it's a path
        httpsNeeds[k] = ''
        unwatch = watchLoad(v, data => {
            httpsNeeds[k] = data
            considerHttps()
        }).unwatch
        await considerHttps()
    })
}

const CFG_HTTPS_PORT = 'https_port'
subscribeConfig({ k:CFG_HTTPS_PORT, defaultValue: -1 }, considerHttps)

async function considerHttps() {
    await stopServer(httpsSrv)
    let port = getConfig('https_port')
    try {
        httpsSrv = https.createServer({ key: httpsNeeds.private_key, cert: httpsNeeds.cert }, frontendApp.callback())
        const missingKey = _.findKey(httpsNeeds, v => !v) as keyof typeof httpsNeeds
        httpsSrv.error = port < 0 ? undefined
            : missingKey && prefix(getConfig(missingKey) ? "cannot read file for " : "missing ", httpsNeedsNames[missingKey])
        if (httpsSrv.error)
            return
    }
    catch(e) {
        httpsSrv.error = "bad private key or certificate"
        console.log("failed to create https server: check your private key and certificate", String(e))
        return
    }
    port = await startServer(httpsSrv, {
        port: getConfig('https_port'),
        name: 'https'
    })
    if (!port) return
    httpsSrv.on('connection', socket =>
        newConnection(socket, true))
    printUrls(port, 'https')
}

interface StartServer { port: number, name:string, net?:string }
function startServer(srv: typeof httpSrv, { port, name, net='0.0.0.0' }: StartServer) {
    return new Promise<number>((resolve, reject) => {
        try {
            if (port < 0)
                return resolve(0)
            srv.listen(port, net, () => {
                const ad = srv.address()
                if (!ad)
                    return reject('no address')
                if (typeof ad === 'string') {
                    srv.close()
                    return reject('type of socket not supported')
                }
                console.log(name, "serving on", net, ':', ad.port)
                resolve(ad.port)
            }).on('error', async e => {
                srv.error = String(e)
                const { code } = e as any
                if (code === 'EADDRINUSE') {
                    const res = await findProcess('port', port)
                    srv.busy = res[0]?.name
                    srv.error = `couldn't listen on port ${port} used by ${srv.busy}`
                }
                console.error(name, srv.error)
                resolve(0)
            })
        }
        catch(e) {
            srv.error = String(e)
            console.error(name, "couldn't listen on port", port, srv.error)
            resolve(0)
        }
    })
}

function stopServer(srv: http.Server) {
    return new Promise(resolve => {
        if (!srv?.listening)
            return resolve(null)
        const ad = srv.address()
        if (ad && typeof ad !== 'string')
            console.log('stopped port ' + ad.port)
        srv.close(err => {
            if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING')
                console.debug('failed to stop server', String(err))
            resolve(err)
        })
    })
}

export function getStatus() {
    return {
        httpSrv,
        httpsSrv,
    }
}

function printUrls(port: number, proto: string) {
    if (!port) return
    const ignore = /^(lo|.*loopback.*|virtualbox.*|.*\(wsl\).*)$/i // avoid giving too much information
    for (const [name, nets] of Object.entries(networkInterfaces())) {
        if (!nets || ignore.test(name)) continue
        console.log('network', name)
        for (const net of nets) {
            if (net.internal) continue
            const appendPort = port === (proto==='https' ? 443 : 80) ? '' : ':' + port
            let { address } = net
            if (address.includes(':'))
                address = '['+address+']'
            console.log('-', proto + '://' + address + appendPort)
        }
    }
}

export function getListeningAdminPort() {
    return (adminSrv?.address() as any)?.port as number | undefined
}
