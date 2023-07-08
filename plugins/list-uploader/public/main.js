"use strict";{
    const { display } = HFS.getPluginConfig()

    HFS.onEvent('additionalEntryDetails', ({ entry }) =>
        HFS.h(Uploader, entry))

    const cache = {}

    function Uploader({ uri }) {
        const fullUri = location.pathname + uri
        const cachedData = cache[fullUri]
        const [freshData, error] = HFS.useApi(!cachedData && 'get_file_details', { uri: fullUri })
        if (!cachedData)
            cache[fullUri] = freshData || Boolean(error)
        const data = freshData || cachedData
        const text = HFS.React.useMemo(() => {
            if (!data || data === true) return ''
            const { upload: x } = data
            return !x ? ''
                : display === 'user' ? x.username
                : display === 'ip' || !x.username ? x.ip
                : x.ip + ' (' + x.username + ')'
        })
        return text && HFS.h('span', { className: 'uploader', title: HFS.t`Uploader` },
            HFS.hIcon('upload'), ' ', text, ' – ')
    }
}
