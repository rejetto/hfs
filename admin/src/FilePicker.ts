// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import { apiCall, useApiList } from './api'
import _ from 'lodash'
import {
    Alert,
    Box,
    Button,
    Checkbox,
    ListItemIcon,
    ListItemText,
    MenuItem,
    TextField,
    Typography
} from '@mui/material'
import { enforceFinal, formatBytes, isWindowsDrive, spinner, pathJoin, dirname, isAbsolutePath } from './misc'
import { ArrowUpward, Home } from '@mui/icons-material'
import { StringField } from './Form'
import { FileIcon, FolderIcon } from './VfsTree'
import { FixedSizeList } from 'react-window'
import AutoSizer from "react-virtualized-auto-sizer"

export interface DirEntry { n:string, s?:number, m?:string, c?:string, k?:'d' }

interface FilePickerProps {
    onSelect:(v:string[])=>void
    multiple?: boolean
    from?: string
    folders?: boolean
}
export default function FilePicker({ onSelect, multiple=true, folders=true, from }: FilePickerProps) {
    const passedDir = useMemo(() => from && dirname(from), [from])
    const [cwd, setCwd] = useState(from && passedDir || '')
    const [ready, setReady] = useState(false)
    useEffect(() => {
        if (passedDir && isAbsolutePath(passedDir))
            return setReady(true)
        apiCall('get_cwd').then(res => {
            if (typeof res.path === 'string')
                setCwd(pathJoin(res.path, passedDir))
            setReady(true)
        })
    }, [passedDir])
    const { list, error, loading } = useApiList<DirEntry>(ready && 'ls', { path: cwd })
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

    const filteredList = useMemo(() => list.filter(it => filterMatch(it.n)), [list,filterMatch])
    if (loading)
        return spinner()
    const pathDelimiter = /[:\\]/.test(cwd) ? '\\' : '/'
    const cwdPostfixed = enforceFinal(pathDelimiter, cwd)
    return h(Fragment, {},
        h(Box, { display:'flex', gap: 1 },
            h(Button, {
                onClick() {
                    const s = /[\\/]$/.test(cwd) ? cwd.slice(0,-1) : cwd // exclude final delimiter, if any
                    setCwd( isWindowsDrive(s) ? '' : s.slice(0, s.lastIndexOf(pathDelimiter)) )
                }
            }, h(ArrowUpward)),
            h(Button, {
                onClick() {
                    setCwd('')
                }
            }, h(Home)),
            h(StringField, {
                label: 'Current path',
                value: cwd,
                onChange: setCwd as any,
            }),
        ),
        error ? h(Alert, { severity:'error' }, String(error))
            : !list.length ? h(Typography, { p:1 }, 'No elements in this folder')
            : h(Fragment, {},
                h(Box, { sx: { flex: 1 } },
                    h(AutoSizer, {
                        children: size =>
                            h(FixedSizeList, {
                                ...size, itemSize: 46, itemCount: filteredList.length, overscanCount: 5,
                                children({ index, style }) {
                                    const it: DirEntry = filteredList[index]
                                    const isFolder = it.k === 'd'
                                    return h(MenuItem, {
                                            style,
                                            key: it.n,
                                            onClick() {
                                                if (isFolder)
                                                    setCwd(cwdPostfixed + it.n)
                                                else
                                                    onSelect([cwdPostfixed + it.n])
                                            }
                                        },
                                        multiple && h(Checkbox, {
                                            checked: sel.includes(it.n),
                                            disabled: !folders && isFolder,
                                            onClick(ev) {
                                                const id = it.n
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
                                            ml: 4
                                        }, formatBytes(it.s))
                                    )
                                }
                            })
                    }),
                ),
                h(Box, { display:'flex', gap: 1 },
                    (multiple || folders) && h(Button, {
                        variant: 'contained',
                        disabled: !folders && !sel.length,
                        sx: { minWidth: 'max-content' },
                        onClick() {
                            onSelect(sel.length ? sel.map(x => cwdPostfixed + x) : [cwd])
                        }
                    }, sel.length || !folders ? `Select (${sel.length})` : `Select this folder`),
                    h(TextField, {
                        value: filter,
                        label: `Filter results (${filteredList.length}${filteredList.length < list.length ? '/'+list.length : ''})`,
                        onChange(ev) {
                            setFilterBounced(ev.target.value)
                        },
                        sx: { minWidth: '20em' },
                        fullWidth: true,
                    }),
                ),
            )
    )
}
