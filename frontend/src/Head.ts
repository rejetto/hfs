import { createElement as h, useContext, useMemo} from 'react'
import { ListContext } from './BrowseFiles'
import { formatBytes, hIcon, prefix } from './misc'
import { Spinner } from './components'
import { useSnapState } from './state'
import { MenuPanel } from './menu'
import { Breadcrumbs } from './Breadcrumbs'

export function Head() {
    return h('header', {},
        h(MenuPanel),
        h(Breadcrumbs),
        h(FolderStats),
        h('div', { style:{ clear:'both' }}),
    )
}

function FolderStats() {
    const { list, loading } = useContext(ListContext)
    const stats = useMemo(() =>{
        let files = 0, folders = 0, size = 0
        for (const x of list) {
            if (x.isFolder)
                ++folders
            else
                ++files
            size += x.s||0
        }
        return { files, folders, size }
    }, [list])
    const { filteredEntries, selected, stoppedSearch } = useSnapState()
    const sel = Object.keys(selected).length
    return h('div', { id:'folder-stats' },
        stoppedSearch ? hIcon('interrupted', { title:'Search was interrupted' })
            : list?.length>0 && loading && h(Spinner),
        [
            prefix('', stats.files,' file(s)'),
            prefix('', stats.folders, ' folder(s)'),
            stats.size ? formatBytes(stats.size) : '',
            sel && sel+' selected',
            filteredEntries >= 0 && filteredEntries+' displayed',
        ].filter(Boolean).join(', ')
    )
}
