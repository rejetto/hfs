// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createAdmin, getAccount, updateAccount } from './perm'
import { configKeyExists, setConfig, getWholeConfig } from './config'
import _ from 'lodash'
import { getUpdates, update } from './update'
import { openAdmin } from './listen'
import yaml from 'yaml'
import { argv, BUILD_TIMESTAMP, VERSION } from './const'
import { createInterface } from 'readline'
import { getAvailablePlugins, mapPlugins, startPlugin, stopPlugin } from './plugins'
import { purgeFileAttr } from './fileAttr'
import { downloadPlugin } from './github'
import { Dict, formatBytes, formatSpeed, formatTimestamp, makeMatcher } from './cross'
import apiMonitor from './api.monitor'

if (!argv.updating)
    try {
        /*
        is this try-block useful in case the stdin is unavailable?
        Not sure, but someone reported a problem using nohup https://github.com/rejetto/hfs/issues/74
        and I've found this example try-catching https://github.com/DefinitelyTyped/DefinitelyTyped/blob/dda83a906914489e09ca28afea12948529015d4a/types/node/readline.d.ts#L489
        */
        createInterface({ input: process.stdin }).on('line', parseCommandLine)
        console.log(`HINT: type "help" for help`)
    }
    catch {
        console.log("console commands not available")
    }

function parseCommandLine(line: string) {
    if (!line) return
    let [name, ...params] = line.trim().split(/ +/)
    name = aliases[name!] || name
    let cmd = (commands as any)[name!]
    if (cmd?.alias)
        cmd = (commands as any)[cmd.alias]
    if (!cmd)
        return console.error("cannot understand entered command, try 'help'")
    if (cmd.cb.length > params.length)
        return console.error("insufficient parameters, expected: " + cmd.params)
    Promise.resolve(cmd.cb(...params)).then(() => console.log("+++ command executed"),
        (err: any) => {
            if (typeof err !== 'string' && !err?.message)
                throw err
            console.error("command failed:", err.message || err)
        })
}

const aliases: Dict<string> = {
    exit: 'quit',
}

const commands = {
    help: {
        params: '',
        cb() {
            console.log("supported commands:",
                ..._.map(commands, ({ params }, name) =>
                    '\n - ' + name + ' ' + params))
        }
    },
    'show-admin': {
        params: '',
        cb(){
            openAdmin()
        }
    },
    'create-admin': {
        params: '<password> [<username>=admin]',
        cb: createAdmin
    },
    'change-password': {
        params: '<user> <password>',
        async cb(user: string, password: string) {
            const acc = getAccount(user)
            if (!acc)
                throw "user doesn't exist"
            await updateAccount(acc!, { password })
        }
    },
    config: {
        params: '<key> <value>',
        cb(key: string, value: string) {
            if (!configKeyExists(key))
                throw "specified key doesn't exist"
            let v: any = value
            try { v = JSON.parse(v) }
            catch {}
            setConfig({ [key]: v })
        }
    },
    'get-config': {
        params: '[<key-mask>]',
        cb(key='*') {
            const matcher = makeMatcher(key)
            const filtered = _.pickBy(getWholeConfig({}), (v, k) => matcher(k))
            console.log('\n' + yaml.stringify(filtered, { lineWidth:1000 }).trim())
        }
    },
    quit: {
        params: '',
        cb() {
            process.emit('SIGTERM')
        }
    },
    update: {
        params: '[<version>=latest]',
        cb: update,
    },
    'check-update': {
        params: '',
        async cb() {
            const update = (await getUpdates(true))[0]
            if (!update)
                throw "you already have the latest version: " + VERSION
            console.log("new version available", update.name)
        }
    },
    version: {
        params: '',
        cb() {
            console.log(VERSION)
            console.log(BUILD_TIMESTAMP)
        }
    },
    'start-plugin': {
        params: '<name>',
        cb: startPlugin,
    },
    'stop-plugin': {
        params: '<name>',
        cb: stopPlugin,
    },
    'download-plugin': {
        params: '<githubUser/repo>',
        cb: downloadPlugin,
    },
    'list-plugins': {
        params: '',
        cb() {
            mapPlugins(p => console.log('ON:', p.id), false)
            getAvailablePlugins().map(p => console.log('OFF:', p.id))
        }
    },
    'purge-file-attr': {
        params: '',
        cb: purgeFileAttr,
    },
    status: {
        params: '',
        async cb() {
            const conn = (await apiMonitor.get_connection_stats().next()).value
            if (conn) {
                const {sent_got: sg} = conn
                console.log(`Speed ↑ ${formatSpeed(conn.outSpeed)} ↓ ${formatSpeed(conn.inSpeed)}`)
                console.log(`Transfered ↑ ${formatBytes(sg[0])} ↓ ${formatBytes(sg[1])} since ${formatTimestamp(sg[2])}`)
                console.log(`Connections ${conn.connections} (${conn.ips} IPs)`)
            }
        }
    }
}
