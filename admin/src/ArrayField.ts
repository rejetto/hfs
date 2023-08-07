// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo, useState } from 'react'
import { IconBtn, isOrderedEqual, setHidden, swap } from './misc'
import { Add, Edit, Delete, ArrowUpward, ArrowDownward, Undo } from '@mui/icons-material'
import { formDialog } from './dialog'
import { DataGrid, GridActionsCellItem, GridAlignment } from '@mui/x-data-grid'
import { FieldDescriptor, FieldProps, labelFromKey } from '@hfs/mui-grid-form'
import { Box, FormHelperText, FormLabel } from '@mui/material'

type ArrayFieldProps<T> = FieldProps<T[]> & { fields: FieldDescriptor[], height?: number, reorder?: boolean, prepend?: boolean }
export function ArrayField<T extends object>({ label, helperText, fields, value, onChange, onError, setApi, reorder, prepend, ...rest }: ArrayFieldProps<T>) {
    const rows = useMemo(() => (value||[]).map((x,$idx) =>
            setHidden({ ...x } as any, x.hasOwnProperty('id') ? { $idx } : { id: $idx })),
        [JSON.stringify(value)]) //eslint-disable-line
    const form = {
        fields: fields.map(({ $width, $column, ...rest }) => rest)
    }
    setApi?.({ isEqual: isOrderedEqual }) // don't rely on stringify, as it wouldn't work with non-json values
    const [undo, setUndo] = useState<typeof value>()
    return h(Fragment, {},
        label && h(FormLabel, { sx: { ml: 1 } }, label),
        helperText && h(FormHelperText, {}, helperText),
        h(Box, { ...rest },
            h(DataGrid, {
                rows,
                sx: { '.MuiDataGrid-virtualScroller': { minHeight: '3em' } },
                hideFooterSelectedRowCount: true,
                hideFooter: true,
                componentsProps: {
                    pagination: {
                        showFirstButton: true,
                        showLastButton: true,
                    }
                },
                columns: [
                    ...fields.map(f => ({
                        field: f.k,
                        headerName: f.headerName ?? (typeof f.label === 'string' ? f.label : labelFromKey(f.k)),
                        disableColumnMenu: true,
                        ...f.$width >= 8 ? { width: f.$width } : { flex: f.$width || 1 },
                        ...f.$column,
                    })),
                    {
                        field: '',
                        type: 'actions',
                        width: 90,
                        headerAlign: 'center' as GridAlignment,
                        renderHeader(){
                            const title = "Add"
                            return h(Fragment, {},
                                h(IconBtn, {
                                    icon: Add,
                                    title,
                                    size: 'small',
                                    onClick: ev =>
                                        formDialog<T>({ form, title }).then(x => {
                                            if (!x) return
                                            const newValue = value?.slice() || []
                                            if (prepend) newValue.unshift(x)
                                            else newValue.push(x)
                                            set(newValue, ev)
                                        })
                                }),
                                undo !== undefined && h(IconBtn, {
                                    icon: Undo,
                                    title: "Undo",
                                    size: 'small',
                                    onClick: ev => set(undo!, ev)
                                }),
                            )
                        },
                        getActions({ row }) {
                            const { $idx=row.id } = row
                            const title = "Modify"
                            return [
                                h(GridActionsCellItem as any, {
                                    icon: h(Edit),
                                    label: title,
                                    title,
                                    onClick(event: MouseEvent) {
                                        formDialog<T>({ values: row as any, form, title }).then(x => {
                                            if (x)
                                                set(value!.map((oldRec, i) => i === $idx ? x : oldRec), event)
                                        })
                                    }
                                }),
                                h(GridActionsCellItem as any, {
                                    icon: h(Delete),
                                    label: "Delete",
                                    showInMenu: reorder,
                                    onClick: ev => set(value!.filter((rec, i) => i !== $idx), ev),
                                }),
                                reorder && $idx && h(GridActionsCellItem as any, {
                                    icon: h(ArrowUpward),
                                    label: "Move up",
                                    showInMenu: true,
                                    onClick: ev => set(swap(value!.slice(), $idx, $idx - 1), ev),
                                }),
                                reorder && $idx < rows.length - 1 && h(GridActionsCellItem as any, {
                                    icon: h(ArrowDownward),
                                    label: "Move down",
                                    showInMenu: true,
                                    onClick: ev => set(swap(value!.slice(), $idx, $idx + 1), ev),
                                }),
                            ].filter(Boolean)
                        }
                    }
                ]
            })
        )
    )

    function set(newValue: NonNullable<typeof value>, event?: any) {
        onChange(newValue, { was: value, event })
        setUndo(value)
    }

}
