(() => { // this wrapper avoids name clashing of outer variables and functions
    const config = HFS.getPluginConfig()

    const inMenu = config.where === 'menu'
    HFS.onEvent('additionalEntryProps', ({ entry: { hits } }, { t }) =>
        hits && !inMenu && `<span class="download-counter" title="${t`download counter`}">${hits}</span>`)

    HFS.onEvent('fileMenu', ({ entry, props }) => {
        if (inMenu && !entry.isFolder)
            props.push(["Downloads", entry.hits || 0])
    })
})()
