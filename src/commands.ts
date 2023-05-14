// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { addAccount, getAccount, updateAccount } from './perm'
import { getConfig, configKeyExists, setConfig } from './config'
import _ from 'lodash'
import { getUpdate, update } from './update'
import { openAdmin } from './listen'
import yaml from 'yaml'
import { argv, BUILD_TIMESTAMP, VERSION } from './const'
import { createInterface } from 'readline'

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
    const [name, ...params] = line.trim().split(/ +/)
    const cmd = (commands as any)[name!]
    if (!cmd)
        return console.error("cannot understand entered command, try 'help'")
    if (cmd.cb.length > params.length)
        return console.error("insufficient parameters, expected: " + cmd.params)
    Promise.resolve(cmd.cb(...params)).then(() => console.log("+++ command executed"),
        (err: any) => {
            if (typeof err === 'string')
                console.error("command failed:", err)
            else
                throw err
        })
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
        async cb(password: string, username='admin') {
            if (getAccount(username))
                throw `user ${username} already exists`
            const acc = addAccount(username, { admin: true })
            await updateAccount(acc!, acc => {
                acc.password = password
            })
        }
    },
    'change-password': {
        params: '<user> <password>',
        async cb(user: string, password: string) {
            const acc = getAccount(user)
            if (!acc)
                throw "user doesn't exist"
            await updateAccount(acc!, acc => {
                acc.password = password
            })
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
        params: '<key>',
        cb(key: string) {
            if (!configKeyExists(key))
                throw "specified key doesn't exist"
            console.log(yaml.stringify(getConfig(key), { lineWidth:1000 }).trim())
        }
    },
    quit: {
        params: '',
        cb() {
            process.exit(0)
        }
    },
    update: {
        params: '',
        cb: update
    },
    'check-update': {
        params: '',
        async cb() {
            const update = await getUpdate()
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
}
