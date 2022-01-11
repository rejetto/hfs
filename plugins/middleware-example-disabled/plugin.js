exports.middleware = function(ctx) {
    ctx.body = 'This plugin is stopping you ;)'
    return true // true = please stop
}
