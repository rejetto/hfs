// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useState } from 'react';
import { apiCall, useApiEx } from './api'
import { Alert, Box } from '@mui/material'
import { focusSelector, isCtrlKey, KeepInScreen } from './misc';
import { Btn, Flex, IconBtn, reloadBtn } from './mui';
import { Save, ContentCopy, Edit } from '@mui/icons-material'
import { TextEditor } from './TextEditor';
import { state } from './state';
import { DisplayField } from '@hfs/mui-grid-form'
import { toast } from './dialog';

export default function ConfigFilePage() {
    state.title = "Config file"
    const { data, reload, element } = useApiEx('get_config_text', {})
    const [text, setText] = useState<string | undefined>()
    const [saved, setSaved] = useState<string | undefined>()
    const [edit, setEdit] = useState(false)
    useEffect(() => { setSaved(data?.text) }, [data])
    useEffect(() => { saved !== undefined && setText(saved || '') }, [saved])
    return h(Fragment, {},
        h(Flex, { flexWrap: 'wrap', justifyContent: 'space-between' },
            h(Btn, { icon: ContentCopy, onClick: copy }, "Copy without passwords"),
            edit ? h(Fragment, {},
                reloadBtn(reload),
                h(IconBtn, {
                    icon: Save,
                    title: "Save\n(ctrl+enter)",
                    modified: text !== saved,
                    onClick: save,
                }),
                h(Alert, { severity: 'warning', sx: { flex: 1, minWidth: '10em' } }, "Be careful, you can easily break things here"),
            ) : h(Btn, {
                icon: Edit,
                variant: 'outlined',
                onClick() {
                    setEdit(true)
                    setTimeout(() => focusSelector('main textarea'), 500)
                }
            }, "Edit"),
            h(Box, { flex: 1, minWidth: 'fit-content' }, h(DisplayField, { label: "File path", value: data?.fullPath }))
        ),
        element || text !== undefined && // avoids bad undo behaviour on start
            h(KeepInScreen, { margin: 10 }, h(TextEditor, {
                value: text,
                disabled: !edit,
                style: { background: '#8881' },
                onValueChange: setText,
                onKeyDown(ev) {
                    if (['s','Enter'].includes(isCtrlKey(ev) as any)) {
                        void save()
                        ev.preventDefault()
                    }
                },
            })),
    )

    function save() {
        return apiCall('set_config_text', { text }).then(() => setSaved(text))
    }

    function copy() {
        if (!text) return
        navigator.clipboard.writeText(text.replace(/^(\s*(\w*password\w*|srp):\s*).+\n/gm, '$1: removed\n'))
        toast("copied")
    }
}
