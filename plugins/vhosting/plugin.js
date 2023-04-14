exports.description = "If you want to have different home folders, based on domain"
exports.version = 3.1 // support masks for host
exports.apiRequired = 2 // 2 is for the config 'array'

exports.config = {
    hosts: {
        label: '',
        type: 'array',
        fields: {
            host: { label: "Domain", helperText: "Wildcards supported: domain.*|other.*" },
            root: { helperText: "Root path in VFS" },
        }
    },
	mandatory: {
		label: "Block requests that are not using any of the domains above",
		type: 'boolean',
	}
}

exports.init = api => {
    const { matches } = api.require('./misc')
    return {
        middleware(ctx) {
            let params // undefined if we are not going to work on api parameters
            if (ctx.path.startsWith(api.const.SPECIAL_URI)) { // special uris should be excluded...
                // ...unless it's a frontend api with a path param
                if (!ctx.path.startsWith(api.const.API_URI)) return
                let { referer } = ctx.headers
                referer &&= new URL(referer).pathname
                if (referer?.startsWith(ctx.state.revProxyPath + api.const.ADMIN_URI)) return // exclude apis for admin-panel
                params = ctx.params
            }

            const hosts = api.getConfig('hosts')
            if (!hosts?.length) return
            const row = hosts?.find(x => matches(ctx.host, x.host))
            if (!row) {
                if (api.getConfig('mandatory')) {
                    ctx.socket.destroy()
                    return true
                }
                return
            }
            if (!params)
                ctx.path = row.root + ctx.path
            else
                for (const [k,v] of Object.entries(params))
                    if (k.startsWith('uri'))
                        params[k] = row.root + v
        }
    }
}
