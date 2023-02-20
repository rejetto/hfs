// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from 'react';
import { apiCall, useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { Alert, Box, Button } from '@mui/material'
import { Delete, Upload } from '@mui/icons-material'
import { IconBtn, readFile, selectFiles } from './misc'
import _ from 'lodash'
import { toast } from './dialog'

export default function LangPage() {
    const { list, error, connecting, reload } = useApiList('get_langs', undefined, { addId: true })
    if (error)
        return error
    return h(Fragment, {},
        h(Alert, { severity: 'info' }, "Translation is limited to Front-end, it doesn't apply to Admin-panel"),
        h(Alert, { severity: 'info' }, "The front-end will automatically apply translation based on the language of the browser. You can force loading of a specific language by appending ?lang=CODE to the URL."),
        h(Box, { mb: 1 },
            h(Button, { variant: 'contained', startIcon: h(Upload), onClick: add }, "Add"),
        ),
        h(DataGrid, {
            loading: connecting,
            rows: list as any,
            hideFooter: true,
            sx: { maxWidth: '40em' },
            columns: [
                {
                    field: 'code',
                    width: 80,
                },
                {
                    field: 'version',
                    width: 80,
                },
                {
                    field: 'author',
                    flex: 1,
                },
                {
                    field: "actions",
                    width: 80,
                    align: 'center',
                    hideSortIcons: true,
                    disableColumnMenu: true,
                    renderCell({ row }) {
                        return h('div', {},
                            h(IconBtn, {
                                icon: Delete,
                                title: "Delete",
                                confirm: "Delete?",
                                async onClick() {
                                    await apiCall('del_lang', _.pick(row, 'code'))
                                    reload()
                                    toast("Deleted")
                                }
                            }),
                        )
                    }
                }
            ]
        })
    )

    function add() {
        selectFiles(async list => {
            if (!list) return
            const langs: any = {}
            for (const f of list)
                langs[f.name] = await readFile(f)
            await apiCall('add_langs', { langs })
            reload()
            toast("Loaded")
        })
    }
}
