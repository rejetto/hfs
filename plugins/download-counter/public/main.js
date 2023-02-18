HFS.onEvent('additionalEntryProps', ({ entry: { hits } }, { t }) =>
    hits && '<span class="download-counter">' + t`Hits: ` + hits + '</span>')
