// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import * as http from 'http'
import { defineConfig, getConfig, subscribeConfig } from './config'
import { app } from './index'
import * as https from 'https'
import { watchLoad } from './watchLoad'
import { networkInterfaces } from 'os';
import { newConnection } from './connections'
import open from 'open'
import { onlyTruthy, prefix, wait } from './misc'
import { ADMIN_URI, DEV } from './const'
import findProcess from 'find-process'
import _ from 'lodash'

interface ServerExtra { name: string, error?: string, busy?: string }
let httpSrv: http.Server & ServerExtra
let httpsSrv: http.Server & ServerExtra

subscribeConfig<number>({ k:'port', defaultValue: 80 }, async port => {
    while (!app)
        await wait(100)
    stopServer(httpSrv).then()
    httpSrv = Object.assign(http.createServer(app.callback()), { name: 'http' })
    port = await startServer(httpSrv, { port })
    if (!port) return
    httpSrv.on('connection', newConnection)
    printUrls(port, 'http')
    if (getConfig('open_browser_at_start'))
        open('http://localhost' + (port === 80 ? '' : ':' + port) + ADMIN_URI).then()
})

defineConfig('open_browser_at_start', { defaultValue: !DEV })

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
    stopServer(httpsSrv).then()
    let port = getConfig('https_port')
    try {
        httpsSrv = Object.assign(
            https.createServer(port < 0 ? {} : { key: httpsNeeds.private_key, cert: httpsNeeds.cert }, app.callback()),
            { name: 'https' }
        )
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
    port = await startServer(httpsSrv, { port: getConfig('https_port') })
    if (!port) return
    httpsSrv.on('connection', socket =>
        newConnection(socket, true))
    printUrls(port, 'https')
}

interface StartServer { port: number, net?:string }
function startServer(srv: typeof httpSrv, { port, net='0.0.0.0' }: StartServer) {
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
                console.log(srv.name, "serving on", net, ':', ad.port)
                resolve(ad.port)
            }).on('error', async e => {
                srv.error = String(e)
                const { code } = e as any
                if (code === 'EADDRINUSE') {
                    const res = await findProcess('port', port)
                    srv.busy = res[0]?.name
                    srv.error = `couldn't listen on port ${port} used by ${srv.busy}`
                }
                console.error(srv.name, srv.error)
                console.log(" >> try specifying a different port like: --port 8011")
                resolve(0)
            })
        }
        catch(e) {
            srv.error = String(e)
            console.error(srv.name, "couldn't listen on port", port, srv.error)
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

const ignore = /^(lo|.*loopback.*|virtualbox.*|.*\(wsl\).*)$/i // avoid giving too much information

export function getUrls() {
    return Object.fromEntries(onlyTruthy([httpSrv, httpsSrv].map(srv => {
        if (!srv.listening)
            return false
        const port = (srv?.address() as any)?.port
        const appendPort = port === (srv.name === 'https' ? 443 : 80) ? '' : ':' + port
        const urls = onlyTruthy(Object.entries(networkInterfaces()).map(([name, nets]) =>
                nets && !ignore.test(name) && nets.map(net => {
                    if (net.internal) return
                    let { address } = net
                    if (address.includes(':'))
                        address = '[' + address + ']'
                    return srv.name + '://' + address + appendPort
                })
        ).flat())
        return urls.length && [srv.name, urls]
    })))
}

function printUrls(port: number, proto: string) {
    if (!port) return
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
