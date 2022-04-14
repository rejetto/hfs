exports.description = "Redirect users trying to access root directly"
exports.version = 1

exports.config = {
    url: { label:"URL", helperText: "Where to redirect" }
}

exports.init = api => ({
    middleware(ctx) {
        if (ctx.path === '/') {
            const url = api.getConfig('url')
            if (url) {
                ctx.redirect(url)
                return true
            }
        }
    }
})
