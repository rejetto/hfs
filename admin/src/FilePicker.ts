import { createElement as h, useEffect, useMemo, useState } from 'react'
import { useApi, useApiList } from './api'
import _ from 'lodash'
import {
    Alert,
    Box,
    Button,
    Checkbox,
    ListItemIcon,
    ListItemText,
    MenuItem,
    MenuList,
    TextField,
    Typography
} from '@mui/material'
import { enforceFinal, formatBytes, isWindowsDrive, spinner } from './misc'
import { ArrowUpward, Home } from '@mui/icons-material'
import { StringField } from './Form'
import { FileIcon, FolderIcon } from './VfsTree'

export interface DirEntry { n:string, s?:number, m?:string, c?:string, k?:'d' }

export default function FilePicker({ onSelect }: { onSelect:(v:string[])=>void }) {
    const [cwd, setCwd] = useState('')
    const [ready, setReady] = useState(false)
    const [gotCwd] = useApi('get_cwd')
    useEffect(() => {
        if (gotCwd) {
            setCwd(gotCwd.path)
            setReady(true)
        }
    }, [gotCwd])
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
    if (loading)
        return spinner()
    const pathDelimiter = /[:\\]/.test(cwd) ? '\\' : '/'
    return h(Box, { display: 'flex', flexDirection: 'column', gap: 2 },
        h(Box, { display:'flex', gap: 1 },
            h(Button, {
                variant: 'contained',
                disabled: !sel.length,
                sx: { minWidth: 'max-content' },
                onClick() {
                    const cwdPostfixed = enforceFinal(pathDelimiter, cwd)
                    onSelect(sel.map(x => cwdPostfixed + x))
                }
            }, `Select (${sel.length})`),
            h(Button, {
                onClick() {
                    setCwd( isWindowsDrive(cwd) ? '' : cwd.slice(0, cwd.lastIndexOf(pathDelimiter)) )
                }
            }, h(ArrowUpward)),
            h(Button, {
                onClick() {
                    setCwd('')
                }
            }, h(Home)),
            h(TextField, {
                value: filter,
                label: 'Filter results',
                onChange(ev) {
                    setFilterBounced(ev.target.value)
                },
                sx: { minWidth: '20em' },
                fullWidth: true,
            }),
        ),
        h(StringField, {
            label: 'Current path',
            value: cwd,
            onChange: setCwd
        }),
        error ? h(Alert, { severity:'error' }, String(error))
            : !list.length ? h(Typography, { p:1 }, 'No elements in this folder')
            : h(MenuList, { sx:{ maxHeight: 'calc(100vh - 24em)', overflow:'auto' } },
                list.map((it:DirEntry) =>
                    h(MenuItem, {
                        key: it.n,
                        sx: { display: filterMatch(it.n) ? undefined : 'none' },
                        onClick(){
                            const id = it.n
                            const removed = sel.filter(x => x !== id)
                            setSel(removed.length < sel.length ? removed : [...sel, id])
                        },
                        onDoubleClick(){
                            setCwd( enforceFinal(pathDelimiter, cwd) + it.n )
                        }
                    },
                        h(Checkbox, { checked: sel.includes(it.n) }),
                        h(ListItemIcon, {}, h(it.k ? FolderIcon : FileIcon)),
                        h(ListItemText, {}, it.n),
                        it.k !== 'd' && it.s !== undefined && h(Typography, { variant:'body2', color:'text.secondary', ml:4 }, formatBytes(it.s) )
                    )
                )
            )
    )
}

