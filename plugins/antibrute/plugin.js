exports.version = 1
exports.description = "Introduce increasing delays between login attempts."

// these settings will grant 4 attempts in first minute, 2 in second minute, and 1 from the third one on
const INCREMENT = 5_000
const CAP = 60_000

const byIp = {}

exports.init = api => {
    const { API_URI } = api.require(api.srcDir + '/const')
    const LOGIN_URI = API_URI + 'loginSrp1'
    return ({
        async middleware(ctx) {
            if (ctx.path !== LOGIN_URI) return
            const k = ctx.ip
            const now = Date.now()
            const rec = byIp[k]
            if (rec) {
                const wait = rec.when - now
                if (wait > 0) {
                    console.log('plugin antibrute is delaying', k, 'for', Math.round(wait / 1000))
                    await new Promise(resolve => setTimeout(resolve, wait))
                }
                ctx.set('x-anti-brute-force', wait)
            }
            const delay = Math.min(CAP, (rec?.delay || 0) + INCREMENT)
            byIp[k] = { delay, when: now + delay }
            setTimeout(() => delete byIp[k], delay * 10) // no memory leak
        }
    })
}

