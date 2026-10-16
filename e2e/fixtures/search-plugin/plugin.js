exports.apiRequired = 14
exports.frontend_js = 'main.js'
exports.init = api => {
    api.registerSearch({
        label: "Fixture search",
        labelKey: 'fixtureSearch_label',
        prepare({ suffix }) {
            return node => suffix === 'pending' ? undefined : node.source?.endsWith(suffix)
        },
    })
}
