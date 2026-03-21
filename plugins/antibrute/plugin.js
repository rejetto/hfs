exports.version = 3.2
exports.description = "Introduce increasing delays between login attempts."
exports.apiRequired = 9.6 // addBlock

exports.config = {
    increment: { type: 'number', min: 1, defaultValue: 5, unit: "seconds", helperText: "How longer user must wait for each login attempt" },
    max: { type: 'number', min: 1, defaultValue: 60, label: "Max delay", unit: "seconds", helperText: "Max seconds to delay before next login is allowed" },
    blockAfter: { type: 'number', xs: 6, min: 1, max: 9999, defaultValue: 100, label: "Block IP after", unit: "attempts", helperText: "localhost excluded" },
    blockForHours: { type: 'number', xs: 6, min: 0, defaultValue: 24, label: "Block for", unit: "hours" },
    exclude: { type: 'string', defaultValue: '', label: "Exclude IPs", helperText: "Net mask syntax" },
    maxQueuePerIp: { type: 'number', min: 1, max: 9999, defaultValue: 32, label: "Max queued per IP" },
    maxQueuePerAccount: { type: 'number', min: 1, max: 9999, defaultValue: 16, label: "Max queued per account" },
    maxQueueGlobal: { type: 'number', min: 1, max: 999999, defaultValue: 512, label: "Max queued globally" },
}
exports.configDialog = {
    maxWidth: 'xs',
}

const byIp = {}
const byAccount = {}
const laneByIp = {}
const laneByAccount = {}
const UNKNOWN_ACCOUNT = 'unknown\t'

exports.init = api => {
    const { isLocalHost, HOUR, netMatches } = api.misc
    const { makeQ } = api.require('./makeQ')
    const gateQ = makeQ(1)
    let waitingGlobal = 0
    const QUEUE_FULL = Symbol('queue_full')
    api.events.multi({
        async attemptingLogin({ ctx, username }) {
            const { ip } = ctx
            const account = getAccountKey(username)
            const ipRec = getRecord(byIp, ip)
            const accountRec = getRecord(byAccount, account)
            let admitted = false
            try {
                await runGate(() => {
                    if (ipRec.waiting >= api.getConfig('maxQueuePerIp')
                    || accountRec.waiting >= api.getConfig('maxQueuePerAccount')
                    || waitingGlobal >= api.getConfig('maxQueueGlobal'))
                        throw QUEUE_FULL
                    // reserve all buckets atomically so we never exceed limits due to parallel requests
                    ipRec.waiting++
                    accountRec.waiting++
                    waitingGlobal++
                    admitted = true
                })
                // serialize waits per ip and per account so parallel bursts can't consume the same penalty window
                await runInLane(getLane(laneByIp, ip), () =>
                    runInLane(getLane(laneByAccount, account), async () => {
                        const now = Date.now()
                        const wait = Math.max(0, ipRec.next - now, accountRec.next - now)
                        if (wait <= 0) return
                        api.log('delaying', ip, 'for', Math.round(wait / 1000))
                        ctx.set('x-anti-brute-force', wait)
                        await new Promise(resolve => setTimeout(resolve, wait))
                    }))
            }
            catch (e) {
                if (e === QUEUE_FULL) {
                    ctx.status = 429
                        return api.events.stop
                }
                throw e
            }
            finally {
                if (admitted) {
                    ipRec.waiting--
                    accountRec.waiting--
                    waitingGlobal--
                }
                armCleanup(byIp, ip, ipRec)
                armCleanup(byAccount, account, accountRec)
                dropLaneIfIdle(laneByIp, ip)
                dropLaneIfIdle(laneByAccount, account)
            }
        },
        failedLogin({ ctx, username }) {
            const { ip } = ctx
            const account = getAccountKey(username)
            const now = Date.now()
            const ipRec = getRecord(byIp, ip)
            const accountRec = getRecord(byAccount, account)
            const ipAttempts = increasePenalty(ipRec, now)
            increasePenalty(accountRec, now)
            if (ipAttempts > api.getConfig('blockAfter') && !isLocalHost(ctx) && !isExcluded(ip)) {
                const hours = api.getConfig('blockForHours')
                api.addBlock({ ip, comment: "From antibrute plugin", expire: hours ? new Date(now + hours * HOUR) : undefined })
            }
            armCleanup(byIp, ip, ipRec)
            armCleanup(byAccount, account, accountRec)
            dropLaneIfIdle(laneByIp, ip)
            dropLaneIfIdle(laneByAccount, account)
        },
        login(ctx) {
            if (ctx.state.account) {
                const { ip } = ctx
                const account = getAccountKey(ctx.state.account.username)
                resetRecord(byIp, ip)
                resetRecord(byAccount, account)
                dropLaneIfIdle(laneByIp, ip)
                dropLaneIfIdle(laneByAccount, account)
            }
        }
    })

    function getRecord(container, key) {
        return container[key] ||= { failures: 0, next: 0, waiting: 0 }
    }

    function increasePenalty(rec, now) {
        const attempts = ++rec.failures
        const max = api.getConfig('max') * 1000
        const delay = Math.min(max, attempts * api.getConfig('increment') * 1000)
        rec.next = Math.max(now, rec.next) + delay
        return attempts
    }

    function armCleanup(records, key, rec) {
        clearTimeout(rec.timer)
        rec.timer = setTimeout(() => {
            // keep records while there are in-flight admissions, otherwise later releases may touch deleted state
            if (rec.waiting)
                return armCleanup(records, key, rec)
            delete records[key]
        }, 24 * HOUR) // no memory leak
    }

    function runGate(job) {
        return new Promise((resolve, reject) => {
            gateQ.add(async () => {
                try { resolve(await job()) }
                catch (e) { reject(e) }
            })
        })
    }

    function getLane(container, key) {
        return container[key] ||= makeQ(1)
    }

    function runInLane(q, job) {
        return new Promise((resolve, reject) => {
            q.add(async () => {
                try { resolve(await job()) }
                catch (e) { reject(e) }
            })
        })
    }

    function dropLaneIfIdle(container, key) {
        const q = container[key]
        if (q?.isWorking() || q?.queueSize()) return
        delete container[key]
    }

    function resetRecord(container, key) {
        const rec = container[key]
        if (!rec) return
        if (rec.waiting) {
            // successful login must clear penalties without dropping admission counters still needed by concurrent requests
            rec.failures = 0
            rec.next = 0
            return
        }
        delete container[key]
    }

    function getAccountKey(username) {
        // fold unknown usernames together to avoid unbounded memory growth from random names
        if (!username || !api.getAccount(String(username)))
            return UNKNOWN_ACCOUNT
        return String(username).toLowerCase()
    }

    function isExcluded(ip) {
        const mask = api.getConfig('exclude')
        if (!mask) return false
        try { return netMatches(ip, mask) }
        catch (e) {
            api.log("bad exclude mask:", String(e))
            return false
        }
    }
}
