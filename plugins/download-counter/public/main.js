const inMenu = HFS.plugins['download-counter'].where === 'menu'
HFS.onEvent('additionalEntryProps', ({ entry: { hits } }, { t }) =>
    hits && !inMenu && `<span class="download-counter" title="${t`download counter`}">${hits}</span>`)

HFS.onEvent('fileMenu', ({ entry, props }) => {
    if (inMenu && !entry.isFolder)
        props.push(["Downloads", entry.hits || 0])
})