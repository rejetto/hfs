HFS.onEvent('additionalEntryProps', ({ entry: { hits } }) =>
    hits && '<span class="download-counter">' + hits + '</span>')
