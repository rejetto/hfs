exports.description = "If you want to have different home folders, based on domain"
exports.version = 3.2
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

exports.configDialog = {
    sx: { maxWidth: '35em' },
}

exports.init = api => {
    const { matches } = api.require('./misc')
    return {
        middleware(ctx) {
            let params // undefined if we are not going to work on api parameters
            if (ctx.path.startsWith(api.Const.SPECIAL_URI)) { // special uris should be excluded...
                if (!ctx.path.startsWith(api.Const.API_URI)) return // ...unless it's an api
                let { referer } = ctx.headers
                referer &&= new URL(referer).pathname
                if (referer?.startsWith(ctx.state.revProxyPath + api.Const.ADMIN_URI)) return // exclude apis for admin-panel
                params = ctx.params || ctx.query // for api we'll translate params
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
            let { root='' } = row
            if (!root || root === '/') return
            if (params === undefined) {
                ctx.path = join(root, ctx.path)
                return
            }
            for (const [k,v] of Object.entries(params))
                if (k.startsWith('uri'))
                    params[k] = Array.isArray(v) ? v.map(x => join(root, x)) : join(root, v)
        }
    }
}

function join(a, b) {
    return a + (b && b[0] !== '/' ? '/' : '') + b
}