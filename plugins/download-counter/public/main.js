HFS.onEvent('additionalEntryProps', ({ entry: { hits } }, { t }) =>
    hits && `<span class="download-counter" title="${t`download counter`}">${hits}</span>`)
