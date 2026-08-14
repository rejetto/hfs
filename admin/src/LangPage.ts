// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react';
import { t } from './i18n'
import { apiCall, useApiEx, useApiList } from './api'
import { DataTable } from './DataTable'
import { Box } from '@mui/material'
import { Delete, Upload } from '@mui/icons-material'
import { CFG, getHFS, readFile, selectFiles } from './misc'
import { Btn, fillFlexParentSx, IconBtn } from './mui'
import { PageProps } from './App'
import _ from 'lodash'
import { alertDialog, toast } from './dialog'
import { Field, SelectField } from '@hfs/mui-grid-form';

export default function LangPage({ setTitleSide }: PageProps) {
    const { list, error, connecting, initializing, reload } = useApiList('get_langs')
    const langs = useMemo(() => _.uniq(['en', ...list.map(x => x.code)]), [list])
    setTitleSide(null)
    return h(Fragment, {},
        h(Box, { sx: { mt: 1, maxWidth: '50em', flex: 1, ...fillFlexParentSx } },
            h(Box, { sx: { mb: 1, display: 'flex', gap: 1, alignItems: 'center', flexDirection: { xs: 'column', sm: 'row' } } },
                h(Btn, { icon: Upload, onClick: add }, t`Add`),
                h(Box, { sx: { display: 'flex', flex: 1, gap: 1, width: { xs: '100%', sm: 'auto' }, flexDirection: { xs: 'column', sm: 'row' } } },
                    h(Box, { sx: { flex: 1 } }, h(FrontendLanguage, { langs })),
                    h(Box, { sx: { flex: 1 } }, h(AdminLanguage)),
                ),
            ),
            h(DataTable, {
                error,
                loading: connecting,
                initializing,
                rows: useMemo(() => _.sortBy(list, x => (x.embedded ? 2 : 1) + x.code), [list.length]), // multi-sorting is only in pro version of DataGrid
                hideFooter: true,
                fillFlex: true,
                columns: [
                    {
                        field: 'code', headerName: t`Code`,
                        width: 110,
                        valueFormatter: (value: string | undefined) => value?.toUpperCase(),
                    },
                    {
                        field: 'language', headerName: t`Language`,
                        width: 180,
                        valueGetter: (_value, row) => languageName(row.code),
                    },
                    {
                        field: 'version', headerName: t`Version`,
                        width: 120,
                        hideUnder: 'sm',
                    },
                    {
                        field: 'author', headerName: t`Author`,
                        flex: 1,
                        hideUnder: 'sm',
                    }
                ],
                actions: ({ row }) => [
                    h(IconBtn, {
                        icon: Delete,
                        title: row.embedded ? t`Cannot delete (embedded)` : t`Delete`,
                        confirm: t("Delete language code \"{code}\"?", { code: row.code }),
                        disabled: row.embedded,
                        async onClick() {
                            await apiCall('del_lang', _.pick(row, 'code'))
                            reload()
                            toast(t`Deleted`)
                        }
                    }),
                ]
            })
        )
    )

    function add() {
        selectFiles(async list => {
            if (!list) return
            const errors = await Promise.all(Array.from(list, f =>
                readFile(f)
                    .then(content => apiCall('add_langs', { langs: { [f.name]: content } }))
                    .then(() => '', e => `${f.name}: ${e.data || e.message || e}`)
            ))
            reload()
            const failed = errors.filter(Boolean)
            if (failed.length)
                await alertDialog(failed.join('.\n'), 'error')
            else
                toast(t`Loaded`)
        }, { accept: '.json' })
    }
}

function FrontendLanguage({ langs }: { langs: string[] }) {
    const K = CFG.force_lang
    const { data, reload, loading } = useApiEx('get_config', { only: [K] })
    const [lang, setLang] = useState()
    useEffect(() => setLang(data?.[K] ?? lang), [data])
    const [saving, setSaving] = useState<string>()

    return h(SelectField as Field<string>, {
        fullWidth: true,
        label: t`Frontend language`,
        size: 'small',
        disabled: Boolean(loading) || typeof saving === 'string',
        value: saving ?? lang,
        async onChange(v) {
            setSaving(v)
            try {
                await apiCall('set_config', { values: { [K]: v } }).catch(alertDialog)
                await reload()
            }
            finally { setSaving(undefined) }
        },
        options: [
            { label: t`Respect browser language`, value: '' },
            ...langs.map(code => ({ value: code, label: `${code.toUpperCase()} — ${languageName(code)}` }))
        ]
    })
}

function AdminLanguage() {
    const current = getHFS().adminLang || ''
    return h(SelectField as Field<string>, {
        fullWidth: true,
        size: 'small',
        sx: { minWidth: '12em' },
        label: t`Admin language`,
        value: current,
        options: [
            { value: '', label: t`Respect browser language` },
            ...getHFS().adminLangs.map((code: string) => ({ value: code, label: `${code.toUpperCase()} — ${languageName(code)}` }))
        ],
        async onChange(value) {
            await apiCall('set_config', { values: { [CFG.admin_lang]: value } })
            location.reload()
        },
    })
}

function languageName(code: string) {
    try {
        const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
        return name ? name[0].toLocaleUpperCase(code) + name.slice(1) : code.toUpperCase()
    }
    catch {
        return code.toUpperCase()
    }
}
