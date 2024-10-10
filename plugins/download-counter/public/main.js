{ // this wrapper avoids name clashing of outer variables and functions
    const config = HFS.getPluginConfig()

    const label = HFS.t(["download counter", "Download counter"])
    const inMenu = config.where === 'menu'
    HFS.onEvent('additionalEntryDetails', ({ entry: { hits } }) =>
        hits && !inMenu && `<span class="download-counter" title="${label}">${hits}</span>`)

    HFS.onEvent('fileMenu', ({ entry, props }) => {
        if (!entry.isFolder)
            props.push({ id: 'download-counter', label, value: entry.hits || 0 })
    })
}