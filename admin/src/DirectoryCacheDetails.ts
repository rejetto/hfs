import { createElement as h } from 'react'
import { useInterval } from 'usehooks-ts'
import type { adminApis } from '../../src/adminApis'
import { useApiEx } from './api'
import { t } from './i18n'

export default function DirectoryCacheDetails() {
    const { data, element, reload, loading } = useApiEx<typeof adminApis.get_directory_cache_status>('get_directory_cache_status')
    // polling must not abort a status request that is still waiting on the server
    useInterval(() => { if (!loading) void reload() }, 1000)
    return element || data && h('div', {},
        h('p', {}, t("{entries} entries in {directories} directories", {
            entries: data.entries.toLocaleString(), directories: data.directories.toLocaleString(),
        })),
        h('p', {}, data.updating.length ? t`Updating` : t`Ready`),
        h('ul', {}, data.updating.map(path => h('li', { key: path, style: { overflowWrap: 'anywhere' } }, path))),
    )
}
