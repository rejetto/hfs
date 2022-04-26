exports.description = "If you want to have different home folders, based on domain"
exports.version = 1
exports.apiRequired = 2 // 2 is for the config 'array'

exports.config = {
    hosts: { label: '', type: 'array', height: 300, fields: [
        { k: 'host', label: "Domain" },
        { k: 'path', helperText: "Root path in VFS" },
    ]  }
}

exports.init = api => ({
    middleware(ctx) {
        let toModify = ctx
        if (ctx.path.startsWith(api.const.SPECIAL_URI)) {
            toModify = ctx.request.query
            if (toModify.path === undefined)
                return
        }
        const hosts = api.getConfig('hosts')
        if (!hosts) return
        for (const row of hosts)
            if (ctx.host === row.host) {
                toModify.path = row.path + toModify.path
                return
            }
    }
})
