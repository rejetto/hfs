exports.init = api => {
    const _ = api.require('lodash')
    const yaml = api.require('yaml')
    const { writeFile, readFile } = api.require('fs')

    const countersFile = 'counters.yaml'

    const counters = {}
    const save = _.debounce(() => {
        writeFile(countersFile, yaml.stringify(counters), err => console.debug(err || 'counters saved'))
    }, 5_000, { maxWait:30_000 })

    // load previous stats
    readFile(countersFile, 'utf8', (err, data) => {
        if (err)
            return err.code === 'ENOENT' || console.debug(countersFile, err)
        Object.assign(counters, yaml.parse(String(data)))
        console.debug('counters loaded')
    })

    return {
        frontend_js: 'hits.js',
        unload: () => save.flush(), // we may have pending savings
        middleware: (ctx) =>
            () => { // execute after other middlewares are done
                if (ctx.status >= 300 || !ctx.vfsNode) return
                const { path } = ctx
                counters[path] = counters[path] + 1 || 1
                save()
            },
        onDirEntry: ({ entry, listPath }) => {
            const path = listPath + entry.n
            const n = counters[path]
            if (n)
                entry.hits = n
        }
    }
}
