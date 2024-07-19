exports.version = 1.0
exports.description = "Show uploader info in list"
exports.apiRequired = 8.3 // useBatch
exports.frontend_js = "main.js"

exports.configDialog = {
    sx: { maxWidth: '20em' },
}

exports.config = {
    display: {
        type: 'select',
        options: {
            "IP only": 'ip',
            "Username only": 'user',
            "IP + username": 'ip+user',
            "Icon + text on mouse over": 'tooltip',
        },
        defaultValue: 'ip+user',
        frontend: true,
    }
}