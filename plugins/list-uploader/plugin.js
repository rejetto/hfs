exports.version = 1.0
exports.description = "Show uploader info in list"
exports.apiRequired = 8.23
exports.frontend_js = "main.js"

exports.configDialog = {
    sx: { maxWidth: '15em' },
}

exports.config = {
    display: {
        type: 'select',
        options: {
            "IP only": 'ip',
            "Username only": 'user',
            "IP + username": 'ip+user',
        },
        defaultValue: 'ip+user',
        frontend: true,
    }
}