exports.version = 2
exports.description = "Introduce increasing delays between login attempts."
exports.apiRequired = 3 // log

exports.config = {
    increment: { type: 'number', min: 1, defaultValue: 5, helperText: "Seconds to add to the delay for each login attempt" },
    max: { type: 'number', min: 1, defaultValue: 60, helperText: "Max seconds to delay before next login is allowed" },
}
exports.configDialog = {
    maxWidth: 'xs',
}

const byIp = {}

exports.init = api => {
    const LOGIN_URI = api.Const.API_URI + 'loginSrp1'
    const { getOrSet } = api.require('./misc')
    return {
        async middleware(ctx) {
            if (ctx.path !== LOGIN_URI) return
            const { ip } = ctx
            const now = Date.now()
            const rec = getOrSet(byIp, ip, () => ({ delay: 0, next: now }))
            const wait = rec.next - now
            const max = api.getConfig('max') * 1000
            const inc = api.getConfig('increment') * 1000
            rec.delay = Math.min(max, rec.delay + inc)
            rec.next += rec.delay
            clearTimeout(rec.timer)
            if (wait > 0) {
                api.log('delaying', ip, 'for', Math.round(wait / 1000))
                ctx.set('x-anti-brute-force', wait)
                await new Promise(resolve => setTimeout(resolve, wait))
            }
            rec.timer = setTimeout(() => delete byIp[ip], rec.delay * 10) // no memory leak
        }
    }
}
