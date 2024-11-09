"use strict";{
    const { React } = HFS
    const { display } = HFS.getPluginConfig()

    HFS.onEvent('additionalEntryDetails', ({ entry }) =>
        HFS.h(Uploader, entry))

    function Uploader({ uri }) {
        const { data } = HFS.useBatch(getDetails, uri)
        const text = React.useMemo(() => {
            if (!data || data === true) return ''
            const { upload: x } = data
            const shouldShowIpWithUser = display === 'ip+user' && x.ip || display === 'tooltip' && HFS.state.adminUrl
            return !x ? ''
                : display === 'user' ? x.username
                : display === 'ip' || !x.username && shouldShowIpWithUser ? x.ip
                : shouldShowIpWithUser ? x.ip + ' (' + x.username + ')' : (x.username || ' ')
        }, [data])
        const iconOnly = display === 'tooltip'
        return text && HFS.h('span', { className: 'uploader', title: HFS.t`Uploader` + (iconOnly ? ' ' + text : '') },
            HFS.hIcon('upload'), ' ', !iconOnly && text, HFS.h('span', { 'aria-hidden': true }, ' – '))
    }

    function getDetails(batched) {
        return batched.length && HFS.apiCall('get_file_details', { uris: batched }).then(x => x.details)
    }

}
