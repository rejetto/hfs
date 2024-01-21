// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Alert, Box } from '@mui/material'
import { Microsoft } from '@mui/icons-material'
import { reloadVfs } from './VfsPage'
import { CFG, newDialog } from './misc'
import { Btn, Flex, reloadBtn } from './mui'
import { apiCall, ApiObject, useApi } from './api'
import { ConfigForm } from './ConfigForm'
import { ArrayField } from './ArrayField'
import { BoolField } from '@hfs/mui-grid-form'
import VfsPathField from './VfsPathField'
import { promptDialog } from './dialog'

export default function VfsMenuBar({ statusApi }: { statusApi: ApiObject }) {
    const isWindows = statusApi.data?.platform === 'win32'
    const { data: integrated, reload } = useApi(isWindows && 'windows_integrated')
    return h(Flex, {
        mb: 2,
        position: 'sticky',
        top: 0,
        zIndex: 2,
        backgroundColor: 'background.paper',
        width: 'fit-content',
    },
        h(Btn, { variant: 'outlined', onClick: roots }, "Roots"),
        reloadBtn(() => reloadVfs()),
        isWindows && h(Btn, {
            icon: Microsoft,
            variant: 'outlined',
            doneMessage: true,
            ...(!integrated?.is ? {
                children: "System integration",
                async onClick() {
                    const msg = h(Box, {}, "We are going to add a command in the right-click of Windows File Manager",
                        h('img', { src: 'win-shell.png', style: {
                                display: 'block',
                                width: 'min(30em, 80vw)',
                                marginTop: '1em',
                            }  }),
                        h(Alert, { severity: 'info' }, "It will also automatically copy the URL, ready to paste!"),
                    )
                    const parent = await promptDialog(msg, { field: { comp: VfsPathField, label: "Add to this folder" }, form: { saveOnEnter: false } })
                    return !parent ? false : apiCall('windows_integration', { parent }).then(reload)
                }
            } : {
                confirm: true,
                children: "Remove integration",
                onClick: () => apiCall('windows_remove').then(reload),
            })
        }),
    )

    function roots() {
        const { close } = newDialog({
            dialogProps: { maxWidth: 'sm' },
            Content: () => h(ConfigForm<{ roots: any, roots_mandatory: boolean }>, {
                onSave() {
                    statusApi.reload() // this config is affecting status data
                    close()
                },
                keys: [CFG.roots, CFG.roots_mandatory],
                form: {
                    fields: [
                        {
                            k: 'roots',
                            label: "Roots for different domains",
                            helperText: "You can decide different home-folders (in the VFS) for different domains, a bit like virtual hosts. If none is matched, the default home will be used.",
                            comp: ArrayField,
                            fields: [
                                { k: 'host', label: "Domain/Host", helperText: "Wildcards supported: domain.*|other.*" },
                                { k: 'root', label: "Home/Root", comp: VfsPathField, placeholder: "default", helperText: "Root path in VFS" },
                            ],
                            toField: x => Object.entries(x || {}).map(([host,root]) => ({ host, root })),
                            fromField: x => Object.fromEntries(x.map((row: any) => [row.host, row.root])),
                        },
                        {
                            k: 'roots_mandatory',
                            label: "Block requests that are not using any of the domains above",
                            helperText: "localhost connections are not included",
                            comp: BoolField,
                        }
                    ]
                }
            })
        })
    }
}
