// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { apiCall, useApi, useApiList } from './api'
import _ from 'lodash'
import { Alert, Box, Checkbox, ListItemIcon, ListItemText, MenuItem, TextField, Typography } from '@mui/material'
import { enforceFinal, formatBytes, isWindowsDrive, err2msg, basename, formatPerc } from './misc'
import { spinner, Center, IconBtn, Flex, IconProgress, useBreakpoint, Btn } from './mui'
import { ArrowUpward, CreateNewFolder, Storage, VerticalAlignTop } from '@mui/icons-material'
import { StringField } from '@hfs/mui-grid-form'
import { FileIcon, FolderIcon } from './VfsTree'
import { FixedSizeList } from 'react-window'
import { promptDialog } from './dialog'
import { LsEntry } from '../../src/api.vfs'

interface FilePickerProps {
    onSelect:(v:string[])=>void
    multiple?: boolean
    from?: string
    folders?: boolean
    files?: boolean
    fileMask?: string
}
let lastPath = '.'
export default function FilePicker({ onSelect, multiple=true, files=true, folders=true, fileMask, from=lastPath }: FilePickerProps) {
    const [cwd, setCwd] = useState(from)
    lastPath = cwd
    const [ready, setReady] = useState(false)
    const isWindows = useRef(false)
    useApi(!ready && 'resolve_path', { path: from, closestFolder: true }, { onResponse: async (_res, body) => {
        try {
            const {path} = body
            if (typeof path !== 'string') return
            setCwd(path)
            isWindows.current = path[1] === ':' || path.startsWith('\\\\') // drive or unc
        }
        finally {
            setReady(true)
        }
    } })
    const { list, props, error, connecting, reload } = useApiList<LsEntry>(ready && 'get_ls', { path: cwd, files, fileMask })
    useEffect(() => {
        setSel([])
        setFilter('')
    }, [cwd])

    const [sel, setSel] = useState<string[]>([])
    const [filter, setFilter] = useState('')
    const setFilterBounced = useMemo(() => _.debounce((x:string) => setFilter(x)), [])
    const filterMatch = useMemo(() => {
        const re = new RegExp(_.escapeRegExp(filter), 'i')
        return (v:string) => re.test(v)
    }, [filter])

    const sm = useBreakpoint('sm')
    const [listHeight, setListHeight] = useState(0)
    const filteredList = useMemo(() => _.sortBy(list.filter(it => filterMatch(it.n)), ['k', 'n']), [list,filterMatch])
    const root = isWindows.current ? '' : '/'
    const pathDelimiter = isWindows.current ? '\\' : '/'
    const cwdDelimiter = enforceFinal(pathDelimiter, cwd)
    const isRoot = cwd.length < 2
    return h(Fragment, {},
        h(StringField, {
            label: "Current folder",
            value: cwd,
            InputLabelProps: { shrink: true },
            helperText: "UNC paths are supported",
            async onChange(v) {
                if (!v)
                    return setCwd(root)
                const res = await apiCall('resolve_path', { path: v })
                if (res.isFolder === false) // the user entered a path to a file
                    return files ? onSelect([v]) // select it, if files are allowed
                        : setCwd(v.slice(0, -basename(v).length-1)) // otherwise consider its folder
                setCwd(res.path)
            },
            end: h(Fragment, {},
                h(IconBtn, {
                    title: "root",
                    disabled: isRoot,
                    icon: VerticalAlignTop,
                    onClick() {
                        setCwd(root)
                    }
                }),
                h(IconBtn, {
                    title: "parent folder",
                    disabled: isRoot,
                    icon: ArrowUpward,
                    onClick() {
                        const cwdND = /[\\/]$/.test(cwd) ? cwd.slice(0,-1) : cwd // exclude final delimiter, if any
                        const last = cwdND.lastIndexOf(pathDelimiter)
                        const isUNCroot = last === 1 // whe cwd is '\\host'
                        const parent = isWindowsDrive(cwdND) || isUNCroot ? root : cwdND.slice(0, last || 1)
                        setCwd(parent)
                    }
                }),
            )
        }),
        error ? h(Alert, { severity: 'error', sx: { flex: 1 } }, err2msg(error))
            : h(Fragment, {},
                h(Box, {
                    ref(x?: HTMLElement){
                        if (!x) return
                        const h = x?.clientHeight - 1
                        if (h - listHeight > 1)
                            setListHeight(h)
                    },
                    sx: { flex: 1, display: 'flex', flexDirection: 'column' }
                },
                    !list.length ? h(Center, { flex: 1, mt: '4em' }, connecting ? spinner() : "No elements in this folder")
                        : h(FixedSizeList, {
                            width: '100%', height: listHeight,
                            itemSize: 46, itemCount: filteredList.length, overscanCount: 5,
                            children({ index, style }) {
                                const it = filteredList[index]
                                const isFolder = it.k === 'd'
                                return h(MenuItem, {
                                        style: { ...style, padding: 0 },
                                        key: it.n,
                                        onClick() {
                                            if (isFolder)
                                                setCwd(cwdDelimiter + it.n)
                                            else
                                                onSelect([cwdDelimiter + it.n])
                                        }
                                    },
                                    multiple && h(Checkbox, {
                                        checked: sel.includes(it.n),
                                        disabled: !folders && isFolder,
                                        onClick(ev) {
                                            const id = it.n + (it.k ? '/' : '')
                                            const removed = sel.filter(x => x !== id)
                                            setSel(removed.length < sel.length ? removed : [...sel, id])
                                            ev.stopPropagation()
                                        },
                                    }),
                                    h(ListItemIcon, {}, h(it.k ? FolderIcon : FileIcon)),
                                    h(ListItemText, { sx: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, it.n),
                                    !isFolder && it.s !== undefined && h(Typography, {
                                        variant: 'body2',
                                        color: 'text.secondary',
                                        ml: 4, mr: 1,
                                    }, formatBytes(it.s))
                                )
                            }
                        })
                ),
                h(Flex, { alignItems: 'center' },
                    (multiple || folders || !files) && h(Btn, {
                        disabled: !sel.length && (!cwd || !folders && files), // !cwd is the drive selection on Windows, which is not a path
                        sx: { minWidth: 'max-content' },
                        onClick() {
                            onSelect(sel.length ? sel.map(x => cwdDelimiter + x) : [cwd + '/'])
                        }
                    }, files && (sel.length || !folders) ? `Select (${sel.length})` : sm ? "Select this folder" : "This folder"),
                    folders && h(Btn, {
                        icon: CreateNewFolder,
                        variant: 'outlined',
                        doneMessage: true,
                        labelIf: 'sm',
                        async onClick() {
                            const s = await promptDialog("New folder name")
                            if (!s) return false
                            await apiCall('mkdir', { path: `${cwd}/${s}` })
                            reload()
                        }
                    }, "New folder"),
                    h(TextField, {
                        size: 'small',
                        value: filter,
                        label: `Filter results (${filteredList.length}${filteredList.length < list.length ? '/'+list.length : ''})`,
                        onChange(ev) {
                            setFilterBounced(ev.target.value)
                        },
                        sx: { flex: 1 },
                    }),
                    props?.total > 0 && h(IconProgress, {
                        icon: Storage,
                        progress: 1,
                        offset: (props.total - props.free) / props.total,
                        title: formatDiskSpace(props),
                    }),
                ),
            )
    )
}

export function formatDiskSpace({ free, total }: { free: number, total: number }) {
    return `${formatBytes(free)} available (${formatPerc(free / total)}) of ${formatBytes(total)}`
}