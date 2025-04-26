exports.version = 3
exports.description = "Introduce increasing delays between login attempts."
exports.apiRequired = 9.6 // addBlock

exports.config = {
    increment: { type: 'number', min: 1, defaultValue: 5, unit: "seconds", helperText: "How longer user must wait for each login attempt" },
    max: { type: 'number', min: 1, defaultValue: 60, label: "Max delay", unit: "seconds", helperText: "Max seconds to delay before next login is allowed" },
    blockAfter: { type: 'number', xs: 6, min: 1, max: 9999, defaultValue: 100, label: "Block IP after", unit: "attempts", helperText: "localhost excluded" },
    blockForHours: { type: 'number', xs: 6, min: 0, defaultValue: 24, label: "Block for", unit: "hours" },
}
exports.configDialog = {
    maxWidth: 'xs',
}

const byIp = {}

exports.init = api => {
    const { isLocalHost, HOUR } = api.misc
    api.events.multi({
        async attemptingLogin({ ctx }) {
            const { ip } = ctx
            const now = new Date
            const rec = byIp[ip] ||= { attempts: 0, next: now }
            const max = api.getConfig('max') * 1000
            const delay = Math.min(max, 1000 * api.getConfig('increment') * ++rec.attempts)
            const wait = rec.next - now
            rec.next = new Date(+rec.next + delay)
            if (rec.attempts > api.getConfig('blockAfter') && !isLocalHost(ctx)) {
                const hours = api.getConfig('blockForHours')
                api.addBlock({ ip, comment: "From antibrute plugin", expire: hours ? new Date(now.getTime() + hours * HOUR) : undefined })
            }
            clearTimeout(rec.timer)
            if (wait > 0) {
                api.log('delaying', ip, 'for', Math.round(wait / 1000))
                ctx.set('x-anti-brute-force', wait)
                await new Promise(resolve => setTimeout(resolve, wait))
            }
            rec.timer = setTimeout(() => delete byIp[ip], 24 * HOUR) // no memory leak
        },
        login(ctx) {
            if (ctx.state.account)
                delete byIp[ctx.ip] // reset if login was successful
        }
        })
}
