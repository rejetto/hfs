{ // this wrapper avoids name clashing of outer variables and functions
    const config = HFS.getPluginConfig()

    const label = HFS.t(["download counter", "Download counter"])
    const inMenu = config.where === 'menu'
    HFS.onEvent('additionalEntryDetails', ({ entry: { hits } }) =>
        hits && !inMenu && HFS.h('span', { className: "download-counter", title: label }, hits))

    HFS.onEvent('fileMenu', ({ entry, props }) => {
        if (!entry.isFolder)
            props.push({ id: 'download-counter', label, value: entry.hits || 0 })
    })
}