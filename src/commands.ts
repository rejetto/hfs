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
import { getInactivePlugins, mapPlugins, startPlugin, stopPlugin } from './plugins'
import { purgeFileAttr } from './fileAttr'
import { downloadPlugin } from './github'
import { Dict, formatBytes, formatSpeed, formatTimestamp, makeMatcher } from './cross'
import apiMonitor from './api.monitor'
import { argv } from './argv'
import { getServerStatus } from './listen'

let debugEnabled = argv.debug || process.env.HFS_DEBUG

if (!argv.updating && !showHelp) {
    try {
        // Not sure if the try is necessary for when stdin is unavailable, but someone reported a problem using nohup https://github.com/rejetto/hfs/issues/74 and I've found this example try-catching https://github.com/DefinitelyTyped/DefinitelyTyped/blob/dda83a906914489e09ca28afea12948529015d4a/types/node/readline.d.ts#L489
        const tty = process.stdin.isTTY && process.stdout.isTTY || undefined
        const prompter = createInterface({ input: process.stdin, output: process.stdout, prompt: tty && 'command> ' })
            .on('line', x => parseCommandLine(x).then(showPrompt))
            .on('SIGINT', () => process.emit('SIGINT')) // readline swallows the first ctrl+c unless we forward it to process-level handlers

        let isClean = true
        const showPrompt = tty && _.debounce(() => {
            if (quitting || !tty || !isClean) return
            prompter.prompt(true)
            isClean = false
        }, 100)
        function clean() {
            if (isClean) return
            // keep console methods synchronous: reposition the cursor immediately and let stream ordering preserve output sequence
            cursorTo(process.stdout, 0) // we don't need to clean as long as the prompt is never longer than the printed line
            isClean = true
        }

        showPrompt?.()
        for (const k of ['log', 'warn', 'error', 'debug'] as const) {
            const original = console[k]
            ;(console as any)[k] = (...args: any[]) =>  {
                if (k === 'debug' && !debugEnabled) return
                if (!quitting && tty)
                    clean()
                try { original(...args) }
                finally {
                    showPrompt?.()
                }
            }
        }

    }
    catch {
        console.log("console commands not available")
        const original = console.debug
        console.debug = (...args: any[]) => debugEnabled && original(...args)
    }
}

async function parseCommandLine(line: string) {
    const tokens = Array.from(line.trim().matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^\s"'\\])+)/g)).map(m =>
        (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\([\\ "'"])/g, '$1')) // unescape
    if (!tokens.length) return
    let [name, ...params] = tokens
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
            const filtered = _.pickBy(getWholeConfig({}), (_v, k) => matcher(k))
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
    debug: {
        params: '',
        cb() {
            debugEnabled = !debugEnabled
            console.log(`debug messages ${debugEnabled ? "on" : "off"}`)
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
            getInactivePlugins().map(p => console.log('OFF:', p.id))
        }
    },
    'purge-file-attr': {
        params: '',
        cb: purgeFileAttr,
    },
    status: {
        params: '',
        async cb() {
            const ports = await getServerStatus(false)
            console.log(_.map(ports, (x, k) =>
                `${k.toUpperCase()} ${x.configuredPort < 0 ? "disabled" : x.listening ? `on port ${x.port}` : (x.error || "not working")}`
            ).join(" – "))
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
