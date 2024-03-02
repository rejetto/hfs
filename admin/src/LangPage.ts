// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react';
import { apiCall, useApiEx, useApiList } from './api'
import { DataTable } from './DataTable';
import { Alert, Box } from '@mui/material'
import { Delete, Upload } from '@mui/icons-material'
import { readFile, selectFiles } from './misc'
import { Btn, IconBtn, useBreakpoint } from './mui'
import _ from 'lodash'
import { alertDialog, toast } from './dialog'
import { Field, SelectField } from '@hfs/mui-grid-form';

export default function LangPage() {
    const { list, error, connecting, reload } = useApiList('get_langs')
    const langs = useMemo(() => ['en', ..._.uniq(list.map(x => x.code))], [list])
    const large = useBreakpoint('md')
    return h(Fragment, {},
        large && h(Alert, { severity: 'info' }, "Translation is limited to Front-end, it doesn't apply to Admin-panel"),
        h(Box, { mt: 1, maxWidth: '40em', flex: 1, display: 'flex', flexDirection: 'column' },
            h(Box, { mb: 1, display: 'flex' },
                h(Btn, { icon: Upload, onClick: add }, "Add"),
                h(Box, { flex: 1 }),
                h(ForceLang, { langs }),
            ),
            h(DataTable, {
                error,
                loading: connecting,
                rows: list as any,
                hideFooter: true,
                sx: { flex: 1 },
                columns: [
                    {
                        field: 'code',
                        width: 110,
                        valueFormatter: ({ value }) => value?.toUpperCase(),
                    },
                    {
                        field: 'version',
                        width: 120,
                        hideUnder: 'sm',
                    },
                    {
                        field: 'hfs_version',
                        headerName: "HFS version",
                        width: 110,
                    },
                    {
                        field: 'author',
                        flex: 1,
                        hideUnder: 'sm',
                    }
                ],
                actions: ({ row }) => [
                    h(IconBtn, {
                        icon: Delete,
                        title: row.embedded ? "Cannot delete (embedded)" : "Delete",
                        confirm: "Delete?",
                        disabled: row.embedded,
                        async onClick() {
                            await apiCall('del_lang', _.pick(row, 'code'))
                            reload()
                            toast("Deleted")
                        }
                    }),
                ]
            })
        )
    )

    function add() {
        selectFiles(async list => {
            if (!list) return
            const langs: any = {}
            for (const f of list)
                langs[f.name] = await readFile(f)
            try {
                await apiCall('add_langs', { langs })
                reload()
                toast("Loaded")
            }
            catch (e: any) {
                await alertDialog(e)
            }
        }, { accept: '.json' })
    }
}

function ForceLang({ langs }: { langs: string[] }) {
    const K = 'force_lang'
    const { data, reload, loading } = useApiEx('get_config', { only: [K] })
    const [lang, setLang] = useState()
    useEffect(() => setLang(data?.[K] ?? lang), [data])
    const [saving, setSaving] = useState<string>()

    return h(SelectField as Field<string>, {
        fullWidth: false,
        disabled: Boolean(loading) || typeof saving === 'string',
        value: saving ?? lang,
        async onChange(v) {
            setSaving(v)
            try {
                await apiCall('set_config', { values: { [K]: v } })
                await reload()
            }
            finally { setSaving(undefined) }
        },
        options: [
            { label: "Respect browser language", value: '' },
            ...langs.map(x => ({ value: x, label: "Force language: " + x }))
        ]
    })
}
