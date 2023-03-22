// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo } from 'react'
import { IconBtn, setHidden } from './misc'
import { Add, Edit, Delete } from '@mui/icons-material'
import { formDialog } from './dialog'
import { DataGrid, GridAlignment } from '@mui/x-data-grid'
import { FieldDescriptor, FieldProps, labelFromKey } from '@hfs/mui-grid-form'
import { Box, FormHelperText, FormLabel } from '@mui/material'

export function ArrayField<T extends object>({ label, helperText, fields, value, onChange, onError, getApi, ...rest }: FieldProps<T[]> & { fields: FieldDescriptor[], height?: number }) {
    const rows = useMemo(() => (value||[]).map((x,$idx) =>
            setHidden({ ...x } as any, 'id' in x ? { $idx } : { id: $idx })),
        [JSON.stringify(value)]) //eslint-disable-line
    const columns = useMemo(() => {
        return [
            ...fields.map(f => ({
                field: f.k,
                headerName: f.headerName ?? (typeof f.label === 'string' ? f.label : labelFromKey(f.k)),
                disableColumnMenu: true,
                ...f.$width >= 8 ? { width: f.$width } : { flex: f.$width || 1 },
                ...f.$column,
            })),
            {
                field: '',
                width: 80,
                disableColumnMenu: true,
                sortable: false,
                align: 'center' as GridAlignment,
                headerAlign: 'center' as GridAlignment,
                renderHeader(){
                    return h(IconBtn, {
                        icon: Add,
                        title: "Add",
                        onClick: (event:any) =>
                            formDialog({ form: { fields } }).then(o => // @ts-ignore
                                o && onChange([...value||[], o], { was: value, event }))
                    })
                },
                renderCell({ row }: any) {
                    const { $idx=row.id } = row
                    return h('div', {},
                        h(IconBtn, {
                            icon: Edit,
                            title: "Modify",
                            onClick: (event:any) =>
                                formDialog<T>({ values: row, form: { fields } }).then(newRec => {
                                    if (!newRec) return
                                    const newValue = value!.map((oldRec, i) => i === $idx ? newRec : oldRec)
                                    onChange(newValue, { was: value, event })
                                }),
                        }),
                        h(IconBtn, {
                            icon: Delete,
                            title: "Delete",
                            confirm: "Delete?",
                            onClick(event: any) {
                                const newValue = value!.filter((rec, i) => i !== $idx)
                                onChange(newValue, { was: value, event })
                            },
                        }),
                    )
                }
            }
        ]
    }, [fields, value, onChange])
    return h(Fragment, {},
        label && h(FormLabel, { sx: { ml: 1 } }, label),
        helperText && h(FormHelperText, {}, helperText),
        h(Box, { height: '20em', ...rest },
            h(DataGrid, {
                columns,
                rows,
                hideFooterSelectedRowCount: true,
                hideFooter: true,
                componentsProps: {
                    pagination: {
                        showFirstButton: true,
                        showLastButton: true,
                    }
                },
            })
        )
    )
}
