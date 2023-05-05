// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react';
import { Field, SelectField } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { Alert, Box } from '@mui/material'
import Editor from 'react-simple-code-editor'
import { Dict, IconBtn, isCtrlKey, modifiedSx, reloadBtn, wikiLink } from './misc';
import { Save } from '@mui/icons-material'
import _ from 'lodash'
import { useDebounce } from 'usehooks-ts'
import md from './md'

export default function CustomHtmlPage() {
    const { data, reload } = useApiEx<{ sections: Dict<string> }>('get_custom_html')
    const [sec, setSec] = useState('')
    const [all, setAll] = useState<Dict<string>>({})
    const [saved, setSaved] = useState({})
    useEffect(() => data && setSaved(data?.sections), [data])
    useEffect(() => setAll(saved), [saved])
    const options = useMemo(() => {
        const keys = Object.keys(all)
        if (!keys.includes(sec))
            setSec(keys?.[0] || '')
        return keys.map(x => ({ value: x, label: _.startCase(x) + (all[x]?.trim() ? ' *' : '') }))
    }, [useDebounce(all, 500)])
    const anyChange = useMemo(() => !_.isEqualWith(saved, all, (a,b) => !a && !b || undefined),
        [saved, all])
    return h(Fragment, {},
        h(Alert, { severity: 'info' },
            md("Add HTML code to some parts of the Front-end. It's saved to file `custom.html`, that you can edit directly with your editor of choice. "),
            wikiLink('customization', "More help")
        ),
        h(Box, { display: 'flex', alignItems: 'center', gap: 1, mb: 1 },
            h(SelectField as Field<string>, { label: "Section", value: sec, options, onChange: setSec }),
            reloadBtn(reload),
            h(IconBtn, {
                icon: Save,
                title: "Save\n(ctrl+s)",
                sx: modifiedSx(anyChange),
                onClick: save,
            }),
        ),
        h(Editor, {
            value: all?.[sec] || '',
            onValueChange: (v: string) =>
                setAll(all => ({ ...all, [sec]: v })),
            highlight: escapeHTML,
            onKeyDown: ev => {
                if (isCtrlKey(ev) === 's') {
                    save().then()
                    ev.preventDefault()
                }
            },
            padding: 10,
            tabSize: 4,
            insertSpaces: true,
            ignoreTabKey: false,
            style: {
                fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace',
                fontSize: '1em',
                flex: 1,
                background: '#8881',
            }
        }),
    )

    function save() {
        return apiCall('set_custom_html', { sections: all }).then(() => setSaved(all))
    }
}

function escapeHTML(unsafe: string) {
    return unsafe.replace(/[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00FF]/g,
        c => '&#' + ('000' + c.charCodeAt(0)).slice(-4) + ';')
}