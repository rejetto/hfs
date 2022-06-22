import { addAccount, getAccount, updateAccount } from './perm'
import { getConfigDefinition, setConfig } from './config'

console.log(`HINT: type "help" for help`)
require('readline').createInterface({ input: process.stdin }).on('line', (line: string) => {
    const [command, ...params] = line.split(/ +/)
    const fun = (commands as any)[command]
    if (!fun)
        return console.error("cannot understand entered command")
    if (fun.length > params.length) {
        const [args] = /\((.+)\)\s*\{/.exec(fun)!
        return console.error("insufficient parameters, expected: " + args)
    }
    fun(...params).then(() =>console.log("command executed"),
        (err: any) => {
            if (typeof err === 'string')
                console.error("command failed:", err)
            else
                throw err
        })
})

const commands = {
    async help() {
        console.log("supported commands:", ...Object.keys(commands).map(x => '\n - ' + x))
    },
    async 'create-admin'(password: string, username='admin') {
        if (getAccount(username))
            throw `user ${username} already exists`
        const acc = addAccount(username, { admin: true })
        await updateAccount(acc!, acc => {
            acc.password = password
        })
    },
    async 'change-password'(user: string, password: string) {
        const acc = getAccount(user)
        if (!acc)
            throw "user doesn't exist"
        await updateAccount(acc!, acc => {
            acc.password = password
        })
    },
    async config(key: string, value: string) {
        const conf = getConfigDefinition(key)
        if (!conf)
            throw "specified key doesn't exist"
        let v: any = value
        try { v = JSON.parse(v) }
        catch {}
        setConfig({ [key]: v })
    },
    async quit() {
        process.exit(0)
    }
}
