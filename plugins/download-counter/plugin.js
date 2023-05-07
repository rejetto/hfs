exports.description = "Counts downloads for each file, and displays the total in the list or file menu"
exports.version = 4.1 // fix: different cases and encodings with urls weren't properly counted
exports.apiRequired = 8

exports.config = {
    where: { frontend: true, type: 'select', defaultValue: 'menu',
        options: ['list', { value: 'menu', label: "file menu" }],
    }
}
exports.configDialog = {
    sx: { maxWidth: '20em' },
}

exports.init = async api => {
    const _ = api.require('lodash')
    const yaml = api.require('yaml')
    const { writeFile, readFile } = api.require('fs/promises')
    const { debounceAsync, newObj } = api.require('./misc')

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
        counters = newObj(counters, (v,k,setKey) => setKey(uri2key(k)) && v)
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
                const k = uri2key(ctx.path)
                counters[k] = counters[k] + 1 || 1
                save()
            },
        onDirEntry: ({ entry, listUri }) => {
            const k = uri2key(listUri + entry.n)
            const n = counters[k]
            if (n)
                entry.hits = n
        }
    }
}

function uri2key(uri) { // normalize uri to avoid having different keys for same file
    try { uri = decodeURIComponent(uri) } // decodeURI doesn't support #=%23
    catch {}
    return uri.toLowerCase()
}
