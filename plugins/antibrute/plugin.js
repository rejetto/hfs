exports.version = 3
exports.description = "Introduce increasing delays between login attempts."
exports.apiRequired = 8.8 // attemptingLogin

exports.config = {
    increment: { type: 'number', min: 1, defaultValue: 5, helperText: "Seconds to add to the delay for each login attempt" },
    max: { type: 'number', min: 1, defaultValue: 60, helperText: "Max seconds to delay before next login is allowed" },
}
exports.configDialog = {
    maxWidth: 'xs',
}

const byIp = {}

exports.init = api => {
    const { getOrSet } = api.require('./misc')
    return {
        unload: api.events.multi({
            attemptingLogin: async  ctx => {
                const { ip } = ctx
                const now = new Date
                const rec = getOrSet(byIp, ip, () => ({ attempts: 0, next: now }))
                const max = api.getConfig('max') * 1000
                const delay = Math.min(max, 1000 * api.getConfig('increment') * ++rec.attempts)
                const wait = rec.next - now
                rec.next = new Date(+rec.next + delay)
                clearTimeout(rec.timer)
                if (wait > 0) {
                    api.log('delaying', ip, 'for', Math.round(wait / 1000))
                    ctx.set('x-anti-brute-force', wait)
                    await new Promise(resolve => setTimeout(resolve, wait))
                }
                rec.timer = setTimeout(() => delete byIp[ip], max * 10) // no memory leak
            },
            login: ctx => {
                if (ctx.state.account)
                    delete byIp[ctx.ip] // reset if login was successful
            }
    })
    }
}
