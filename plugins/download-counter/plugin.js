// other plugins can use ctx.state.download_counter_ignore to mark downloads that shouldn't be counted

exports.description = "Counts downloads for each file, and displays the total in the list or file menu"
exports.version = 6.3 // fixed slow conversion of big legacy files
exports.apiRequired = 8.89  // openDb

exports.config = {
    where: { frontend: true, label: "Where to display counter", type: 'select', defaultValue: 'menu',
        options: ['list', { value: 'menu', label: "file menu" }],
    },
    archives: { defaultValue: true, type: 'boolean', label: "Count files in zip/archives" },
}
exports.configDialog = {
    sx: { maxWidth: '20em' },
}

exports.init = async api => {
    const db = await api.openDb('counters.kv', { defaultPutDelay: 5_000, maxPutDelay: 30_000 })

    if (!db.size()) try { // load legacy file
        const countersFile = 'counters.yaml'
        const yaml = api.require('yaml')
        const input = api.require('fs').createReadStream(countersFile)
        const readline = api.require('readline').createInterface({ input })
        for await (const line of readline) {
            const parsed = yaml.parse(line) // parsing a 3.7MB file as a whole takes 25x in my tests
            for (const [k,v] of Object.entries(parsed))
                db.put(uri2key(k), v)
        }
        api.require('fs').promises.rename(countersFile, countersFile + ' - old format, now converted, you can delete')
        api.log("data converted")
    }
    catch(err) {
        if (err.code !== 'ENOENT')
            api.log(err)
    }

    return {
        frontend_js: 'main.js',
        frontend_css: 'style.css',
        middleware: ctx => () => { // callback = execute after other middlewares are done
            if (ctx.status >= 300 || ctx.state.download_counter_ignore || ctx.state.considerAsGui || ctx.state.includesLastByte === false) return
            if (!(ctx.state.vfsNode || api.getConfig('archives') && ctx.state.archive)) return
            ctx.state.completed.then(() => {
                const key = uri2key(ctx.path)
                const entries = ctx.state.vfsNode ? [key]
                    : ctx.state.originalStream?.getArchiveEntries?.().filter(x => x.at(-1) !== '/').map(x => key + uri2key(x))
                if (!entries) return
                for (const k of entries)
                    db.put(k, db.getSync(k) + 1 || 1)
            })
        },
        onDirEntry({ entry, listUri })  {
            const k = uri2key(listUri + entry.n)
            const n = db.getSync(k)
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
