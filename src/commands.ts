// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createAdmin, getAccount, updateAccount } from './perm'
import { configKeyExists, setConfig, getWholeConfig, showHelp } from './config'
import _ from 'lodash'
import { getUpdates, update } from './update'
import { openAdmin } from './listen'
import yaml from 'yaml'
import { BUILD_TIMESTAMP, VERSION } from './const'
import { createInterface, cursorTo } from 'node:readline'
import { quitting } from './first'
import { getAvailablePlugins, mapPlugins, startPlugin, stopPlugin } from './plugins'
import { purgeFileAttr } from './fileAttr'
import { downloadPlugin } from './github'
import { Dict, formatBytes, formatSpeed, formatTimestamp, makeMatcher } from './cross'
import apiMonitor from './api.monitor'
import { argv } from './argv'
import { consoleHint } from './consoleLog'
import { debounceAsync } from './debounceAsync'

if (!argv.updating && !showHelp) {
    try {
        // Not sure if the try is necessary for when stdin is unavailable, but someone reported a problem using nohup https://github.com/rejetto/hfs/issues/74 and I've found this example try-catching https://github.com/DefinitelyTyped/DefinitelyTyped/blob/dda83a906914489e09ca28afea12948529015d4a/types/node/readline.d.ts#L489
        const tty = process.stdin.isTTY && process.stdout.isTTY || undefined
        const prompter = createInterface({ input: process.stdin, output: process.stdout, prompt: tty && 'command> ' })
                .on('line', x => parseCommandLine(x).then(showPrompt))

        let isClean = true
        let cleaning: undefined | Promise<void>
        const showPrompt = tty && debounceAsync(async () => {
            await cleaning
            if (quitting || !tty) return
            prompter.prompt(true)
            isClean = false
        }, { wait: 100 })
        function clean() {
            if (isClean) return
            return cleaning ||= new Promise(resolve => {
                cursorTo(process.stdout, 0, undefined, () => {// we don't need to clean as long as the prompt is never longer then the printed line
                    resolve()
                    cleaning = undefined
                    isClean = true
                })
            })
        }

        showPrompt?.()
        // print this hint when we have not been printing anything else for a while, to not get mixed too much
        let printHintOnce = tty && _.debounce(() => {
            consoleHint("this is an interactive console, you can enter commands")
            printHintOnce = undefined as any // never more
        }, 2000)
        _.each(console, (v: any, k) => {
            if (!_.isFunction(v)) return
            ;(console as any)[k] = async (...args: any[]) =>  {
                if (!quitting && tty)
                    await clean()
                try { v(...args) }
                finally {
                    showPrompt?.()
                    printHintOnce?.()
                }
            }
        })

    }
    catch {
        console.log("console commands not available")
    }
}

async function parseCommandLine(line: string) {
    if (!line) return
    let [name, ...params] = line.trim().split(/ +/)
    name = aliases[name!] || name
    let cmd = (commands as any)[name!]
    if (cmd?.alias)
        cmd = (commands as any)[cmd.alias]
    if (!cmd)
        return console.error("invalid command, try 'help'")
    if (cmd.cb.length > params.length)
        return console.error("insufficient parameters, expected: " + cmd.params)
    try {
        await cmd.cb(...params)
        console.log("+++ command executed")
    }
    catch(err: any) {
        if (typeof err !== 'string' && !err?.message)
            throw err
        console.error("command failed:", err.message || err)
    }
}

const aliases: Dict<string> = { ver: 'version', exit: 'quit' }

const commands = {
    help: {
        params: '',
        cb() {
            console.log("available commands:",
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
        async cb(key: string, value: string) {
            if (!configKeyExists(key))
                throw "specified key doesn't exist"
            let v: any = value
            try { v = JSON.parse(v) }
            catch {}
            await setConfig({ [key]: v })
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
            console.log(VERSION, 'build', BUILD_TIMESTAMP)
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
