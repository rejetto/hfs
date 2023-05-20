{ // this wrapper avoids name clashing of outer variables and functions
    const config = HFS.getPluginConfig()

    const inMenu = config.where === 'menu'
    HFS.onEvent('additionalEntryDetails', ({ entry: { hits } }) =>
        hits && !inMenu && `<span class="download-counter" title="${HFS.t`download counter`}">${hits}</span>`)

    HFS.onEvent('fileMenu', ({ entry, props }) => {
        if (inMenu && !entry.isFolder)
            props.push(["Downloads", entry.hits || 0])
    })
}