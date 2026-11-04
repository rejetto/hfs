import { storedMap } from './persistence'
import { createHash } from 'node:crypto'
import type { Account } from './perm'

const stamps = new Map<string, { stamp: string, credentials: string }>()
const prefix = 'sessionStamp:'
// random signing keys already invalidate all cookies on restart
const persistent = process.env.COOKIE_SIGN_KEYS !== undefined
export const sessionStampsReady = load()

export function getSessionStamp(username: string) {
    return stamps.get(username)?.stamp
}

export function renewSessionStamp(username: string) {
    const current = stamps.get(username)
    if (current)
        setStamp(username, current.credentials)
}

export function syncSessionStamps(accounts: Record<string, Account>) {
    for (const username of stamps.keys())
        if (!(username in accounts)) {
            stamps.delete(username)
            if (persistent)
                void storedMap.del(prefix + username)
        }
    for (const [username, account] of Object.entries(accounts)) {
        // compare values across reloads and restarts without duplicating credentials in data.kv
        const credentials = createHash('sha256').update(JSON.stringify([
            account?.srp, account?.password, account?.plugin,
        ])).digest('hex')
        if (stamps.get(username)?.credentials !== credentials)
            setStamp(username, credentials)
    }
}

function setStamp(username: string, credentials: string) {
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
    const record = { stamp, credentials }
    stamps.set(username, record)
    // accepted tradeoff: with fixed signing keys, a crash before this delayed write may lose a revocation
    if (persistent)
        void storedMap.put(prefix + username, record)
}

async function load() {
    for await (const [key, record] of storedMap.iterator({ startsWith: prefix })) {
        if (persistent)
            stamps.set(key.slice(prefix.length), record)
        else // re-enabling the same signing keys later must not revive cookies revoked during this run
            void storedMap.del(key)
    }
}
