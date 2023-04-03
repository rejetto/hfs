exports.description = "Counts downloads for each file, and displays the total in the list or file menu"
exports.version = 4 // config.where
exports.apiRequired = 6

exports.config = {
    where: { frontend: true, type: 'select', options: ['list', 'menu'] }
}

exports.init = async api => {
    const _ = api.require('lodash')
    const yaml = api.require('yaml')
    const { writeFile, readFile } = api.require('fs/promises')
    const { debounceAsync } = api.require('./misc')

    const countersFile = 'counters.yaml'

    let counters = {}
    const save = debounceAsync(async () => {
        await writeFile(countersFile, yaml.stringify(counters))
        console.debug('counters saved')
    }, 5_000, { maxWait:30_000 })

    // load previous stats
    try {
        const data = await readFile(countersFile, 'utf8')
        counters = yaml.parse(data) || {}
        console.debug('counters loaded')
    }
    catch(err) {
        if (err.code !== 'ENOENT')
            console.debug(countersFile, err)
    }

    return {
        frontend_js: 'main.js',
        frontend_css: 'style.css',
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
