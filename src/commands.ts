import { addAccount, getAccount, updateAccount } from './perm'
import { getConfig, getConfigDefinition, setConfig } from './config'
import _ from 'lodash'
import { getUpdate, update } from './update'
import { openAdmin } from './listen'
import yaml from 'yaml'
import { BUILD_TIMESTAMP, VERSION } from './const'

console.log(`HINT: type "help" for help`)
require('readline').createInterface({ input: process.stdin }).on('line', (line: string) => {
    if (!line) return
    const [name, ...params] = line.trim().split(/ +/)
    const cmd = (commands as any)[name]
    if (!cmd)
        return console.error("cannot understand entered command, try 'help'")
    if (cmd.cb.length > params.length)
        return console.error("insufficient parameters, expected: " + cmd.params)
    cmd.cb(...params).then(() =>console.log("+++ command executed"),
        (err: any) => {
            if (typeof err === 'string')
                console.error("command failed:", err)
            else
                throw err
        })
})

const commands = {
    help: {
        params: '',
        async cb() {
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
        async cb(key: string, value: string) {
            const conf = getConfigDefinition(key)
            if (!conf)
                throw "specified key doesn't exist"
            let v: any = value
            try { v = JSON.parse(v) }
            catch {}
            setConfig({ [key]: v })
        }
    },
    'show-config': {
        params: '<key>',
        async cb(key: string) {
            const conf = getConfigDefinition(key)
            if (!conf)
                throw "specified key doesn't exist"
            console.log(yaml.stringify(getConfig(key), { lineWidth:1000 }).trim())
        }
    },
    quit: {
        params: '',
        async cb() {
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
        async cb() {
            console.log(VERSION)
            console.log(BUILD_TIMESTAMP)
        }
    },
}
