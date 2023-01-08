exports.description = "If you want to have different home folders, based on domain"
exports.version = 3 // support masks for host
exports.apiRequired = 2 // 2 is for the config 'array'

exports.config = {
    hosts: {
        label: '',
        type: 'array',
        fields: {
            host: { label: "Domain", helperText: "Masks supported: domain.*|other.*" },
            root: { helperText: "Root path in VFS" },
        }
    },
	mandatory: {
		label: "Block requests that are not using any of the domains above",
		type: 'boolean',
	}
}

exports.init = api => {
    const { isMatch } = api.require('micromatch')
    return {
        middleware(ctx) {
            let toModify = ctx
            if (ctx.path.startsWith(api.const.SPECIAL_URI)) { // special uris should be excluded...
                toModify = ctx.params
                if (toModify.path === undefined) // ...unless they carry a path in the query. In that case we'll work that.
                    return
            }
            const hosts = api.getConfig('hosts')
            if (!hosts?.length) return
            for (const row of hosts)
                if (isMatch(ctx.host, row.host)) {
                    toModify.path = row.root + toModify.path
                    return
                }
            if (api.getConfig('mandatory')) {
                ctx.socket.destroy()
                return true
            }
        }
    }
}
