import { addAccount, getAccount, updateAccount } from './perm'
import { getConfigDefinition, setConfig } from './config'
import _ from 'lodash'

console.log(`HINT: type "help" for help`)
require('readline').createInterface({ input: process.stdin }).on('line', (line: string) => {
    if (!line) return
    const [name, ...params] = line.split(/ +/)
    const cmd = (commands as any)[name]
    if (!cmd)
        return console.error("cannot understand entered command, try 'help'")
    if (cmd.cb.length > params.length)
        return console.error("insufficient parameters, expected: " + cmd.params)
    cmd.cb(...params).then(() =>console.log("command executed"),
        (err: any) => {
            if (typeof err === 'string')
                console.error("command failed:", err)
            else
                throw err
        })
})

function getFunctionArgs(fun: Function) {
    const args = /\((.*)\)\s*\{/.exec(fun.toString())![1]
    return args && args.split(',').map(arg => {
        const [name,def] = arg.split('=')
        return `<${name.trim()}>${def ? '='+def.trim() : ''}`
    }).join(' ')
}

const commands = {
    help: {
        params: '',
        async cb() {
            console.log("supported commands:",
                ..._.map(commands, ({ params }, name) =>
                    '\n - ' + name + ' ' + params))
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
    quit: {
        params: '',
        async cb() {
            process.exit(0)
        }
    }
}
