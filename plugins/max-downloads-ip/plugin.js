exports.description = "Limit number of simultaneous downloads per IP address"
exports.version = 1
exports.apiRequired = 1

exports.config = {
    limit: { type: 'number', min: 1, placeholder: "no limit" }
}

exports.init = api => {
    const _ = api.require('lodash')
    // see who's already downloading
    const countByIp = _.countBy(api.getConnections(), conn => {
        const { ctx } = conn
        if (!isToBeCounted(ctx))
            return 'ignore'
        watchForEnd(ctx)
        return ctx.ip
    })
    delete countByIp.ignore

    const timer = setInterval(() => { // hourly garbage collector
        for (const k in countByIp)
            if (countByIp[k] <= 0)
                delete countByIp[k]
    }, 3600_000)

    function watchForEnd(ctx) {
        ctx.body.on('close', () => --countByIp[ctx.ip])
    }

    return {
        unload() {
            clearInterval(timer)
        },
        middleware(ctx) {
            return () => { // information we need is set by another middleware, so we wait for it
                if (!isToBeCounted(ctx)) return
                const { ip } = ctx
                const n = 1 + (countByIp[ip] || 0) // keep track
                if (n > api.getConfig('limit')) {
                    ctx.status = 429
                    return true
                }
                countByIp[ip] = n
                watchForEnd(ctx)
            }
        }
    }
}

function isToBeCounted(ctx) {
    return ctx?.vfsNode // when this property is set, the request is serving a file from the vfs
}
