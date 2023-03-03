// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo } from 'react'
import { formatBytes, hIcon } from './misc'
import { CustomCode, Spinner } from './components'
import { useSnapState } from './state'
import { MenuPanel } from './menu'
import { Breadcrumbs } from './Breadcrumbs'
import { FilterBar } from './FilterBar'
import { useI18N } from './i18n'

export function Head() {
    return h('header', {},
        h(MenuPanel),
        h(CustomCode, { name: 'afterMenuBar' }),
        h(Breadcrumbs),
        h(FolderStats),
        h(FilterBar),
    )
}

function FolderStats() {
    const { list, loading, stoppedSearch } = useSnapState()
    const { files, folders, size } = useMemo(() => {
        let files = 0, folders = 0, size = 0
        for (const { isFolder, s } of list) {
            if (isFolder)
                ++folders
            else
                ++files
            size += s || 0
        }
        return { files, folders, size }
    }, [list])
    const { t } = useI18N()
    return h(Fragment, {},
        h('div', { id:'folder-stats' },
            stoppedSearch ? hIcon('interrupted', { title: t`Search was interrupted` })
                : list.length>0 && loading && h(Spinner),
            [
                files && t('n_files', { n: files }, '{n,plural,one{# file} other{# files}}'),
                folders && t('n_folders', { n: folders }, '{n,plural,one{# folder} other{# folders}}'),
                size ? formatBytes(size) : '',
            ].filter(Boolean).join(', '),
        ),
        h('div', { style:{ clear:'both' }}),
    )
}
