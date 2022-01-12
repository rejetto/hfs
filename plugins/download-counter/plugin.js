const { writeFile, readFile } = require('fs')
const _ = require('lodash')
const yaml = require('yaml')

const countersFile = 'counters.yaml'

const counters = {}
// load previous stats
readFile(countersFile, 'utf8', (err, data) => {
    if (err)
        return err.code === 'ENOENT' || console.debug(countersFile, err)
    Object.assign(counters, yaml.parse(String(data)))
    console.debug('counters loaded')
})

const save = _.debounce(() => {
    writeFile(countersFile, yaml.stringify(counters), err => console.debug(err || 'counters saved'))
}, 5_000, { maxWait:30_000 })

exports.unload = ()=> save.flush() // we may have pending savings

exports.middleware = (ctx) =>
    () => { // execute after other middlewares are done
        if (ctx.status >= 300 || !ctx.fileSource) return
        const { path } = ctx
        counters[path] = counters[path] + 1 || 1
        save()
    }

exports.onDirEntry = ({ entry, listPath }) => {
    const path = listPath + entry.n
    const n = counters[path]
    if (n)
        entry.hits = n
}

exports.frontend_js = 'hits.js'
