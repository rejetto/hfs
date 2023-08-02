// other plugins can use ctx.state.download_counter_ignore to mark downloads that shouldn't be counted

exports.description = "Counts downloads for each file, and displays the total in the list or file menu"
exports.version = 5 // count files in archive
exports.apiRequired = 8.3

exports.config = {
    where: { frontend: true, type: 'select', defaultValue: 'menu',
        options: ['list', { value: 'menu', label: "file menu" }],
    },
    archives: { defaultValue: true, type: 'boolean', label: "Count files in zip/archives" },
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
                if (ctx.status >= 300 || ctx.state.download_counter_ignore || ctx.state.includesLastByte === false) return
                if (!(ctx.vfsNode || api.getConfig('archives') && ctx.state.archive)) return
                ctx.state.completed.then(() => {
                    const key = uri2key(ctx.path)
                    const entries = ctx.vfsNode ? [key]
                        : ctx.state.originalStream?.getArchiveEntries?.().filter(x => x.at(-1) !== '/').map(x => key + uri2key(x))
                    if (!entries) return
                    for (const k of entries)
                        counters[k] = counters[k] + 1 || 1
                    save()
                })
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
