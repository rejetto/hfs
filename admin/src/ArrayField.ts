// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo, useState } from 'react'
import { Dict, isOrderedEqual, setHidden, swap } from './misc'
import { Add, Edit, Delete, ArrowUpward, ArrowDownward, Undo, Check } from '@mui/icons-material'
import { formDialog } from './dialog'
import { GridActionsCellItem, GridAlignment, GridColDef } from '@mui/x-data-grid'
import { BoolField, FieldDescriptor, FieldProps, labelFromKey } from '@hfs/mui-grid-form'
import { Box, FormHelperText, FormLabel } from '@mui/material'
import { DateTimeField } from './DateTimeField'
import _ from 'lodash'
import { Center, IconBtn } from './mui'
import { DataTable } from './DataTable'

type ArrayFieldProps<T> = FieldProps<T[]> & { fields: FieldDescriptor[], height?: number, reorder?: boolean, prepend?: boolean, autoRowHeight?: boolean }
export function ArrayField<T extends object>({ label, helperText, fields, value, onChange, onError, setApi, reorder, prepend, noRows, valuesForAdd, autoRowHeight, ...rest }: ArrayFieldProps<T>) {
    if (!Array.isArray(value)) // avoid crash if non-array values are passed, especially developing plugins
        value = []
    const rows = useMemo(() => value!.map((x,$idx) =>
            setHidden({ ...x } as any, x.hasOwnProperty('id') ? { $idx } : { id: $idx })),
        [JSON.stringify(value)]) //eslint-disable-line
    const form = {
        fields: fields.map(({ $width, $column, $type, $hideUnder, ...rest }) => _.defaults(rest, byType[$type]?.field))
    }
    setApi?.({ isEqual: isOrderedEqual }) // don't rely on stringify, as it wouldn't work with non-json values
    const [undo, setUndo] = useState<typeof value>()
    return h(Fragment, {},
        label && h(FormLabel, { sx: { ml: 1 } }, label),
        helperText && h(FormHelperText, {}, helperText),
        h(Box, { ...rest },
            h(DataTable, {
                rows,
                ...autoRowHeight && { getRowHeight: () => 'auto' as const },
                sx: {
                    '.MuiDataGrid-virtualScroller': { minHeight: '3em' },
                    ...autoRowHeight && { '.MuiDataGrid-cell': { minHeight: '52px !important' } }
                },
                hideFooterSelectedRowCount: true,
                hideFooter: true,
                slots: {
                    noRowsOverlay: () => h(Center, {}, noRows || "No entries"),
                },
                slotProps: {
                    pagination: {
                        showFirstButton: true,
                        showLastButton: true,
                    }
                },
                columns: [
                    ...fields.map(f => {
                        const def = byType[f.$type]?.column
                        return {
                            field: f.k,
                            headerName: f.headerName ?? (typeof f.label === 'string' ? f.label : labelFromKey(f.k)),
                            disableColumnMenu: true,
                            valueGetter({ value }: any) {
                                return (f.toField || _.identity)(value)
                            },
                            ...def,
                            ...f.$width ? { [f.$width >= 8 ? 'width' : 'flex']: f.$width } : (!def?.width && !def?.flex && { flex: 1 }),
                            hideUnder: f.$hideUnder,
                            ...f.$column,
                        }
                    }),
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
                                        formDialog<T>({ form, title, values: valuesForAdd }).then(x => {
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
                                    onClick(ev: MouseEvent) {
                                        ev.stopPropagation()
                                        formDialog<T>({ values: row as any, form, title }).then(x => {
                                            if (x)
                                                set(value!.map((oldRec, i) => i === $idx ? x : oldRec), ev)
                                        })
                                    }
                                }),
                                h(GridActionsCellItem as any, {
                                    icon: h(Delete),
                                    label: "Delete",
                                    showInMenu: reorder,
                                    onClick: ev => {
                                        ev.stopPropagation()
                                        set(value!.filter((rec, i) => i !== $idx), ev)
                                    },
                                }),
                                reorder && $idx && h(GridActionsCellItem as any, {
                                    icon: h(ArrowUpward),
                                    label: "Move up",
                                    showInMenu: true,
                                    onClick: ev => {
                                        ev.stopPropagation()
                                        set(swap(value!.slice(), $idx, $idx - 1), ev)
                                    },
                                }),
                                reorder && $idx < rows.length - 1 && h(GridActionsCellItem as any, {
                                    icon: h(ArrowDownward),
                                    label: "Move down",
                                    showInMenu: true,
                                    onClick: ev => {
                                        ev.stopPropagation()
                                        set(swap(value!.slice(), $idx, $idx + 1), ev)
                                    },
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

const byType: Dict<{ field?: Partial<FieldDescriptor>, column?: Partial<GridColDef> }> = {
    boolean: {
        field: { comp: BoolField },
        column: { renderCell: ({ value }) => value && h(Check) },
    },
    dateTime: {
        field: { comp: DateTimeField },
        column: {
            type: 'dateTime', minWidth: 96, flex: 0.5,
            valueGetter: ({ value }) => value && new Date(value),
            renderCell: ({ value }) => value && h(Box, {}, value.toLocaleDateString(), h('br'), value.toLocaleTimeString())
        }
    }
}