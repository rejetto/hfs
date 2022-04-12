HFS.onEvent('additionalEntryProps', ({ entry }) => {
    const n = entry.hits
    if (typeof n === 'number')
        return 'Hits: ' + n + ' - '
})
