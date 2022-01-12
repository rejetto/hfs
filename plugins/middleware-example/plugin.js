const api = exports.api = {}

exports.middleware = function(ctx) {
    ctx.body = 'This plugin is stopping you: ' + api.getConfig('message')
    return true // true = please stop
}
