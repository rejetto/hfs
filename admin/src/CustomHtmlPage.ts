// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ComponentProps, createElement as h, Fragment, useEffect, useMemo, useState } from 'react';
import { Field, FieldProps, SelectField } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { Alert, Box, FormHelperText, FormLabel } from '@mui/material'
import Editor from 'react-simple-code-editor'
import { Dict, IconBtn, isCtrlKey, modifiedSx, reloadBtn, wikiLink } from './misc';
import { Save } from '@mui/icons-material'
import _ from 'lodash'
import { useDebounce } from 'usehooks-ts'
import md from './md'

export default function CustomHtmlPage() {
    const { data, reload } = useApiEx<{ sections: Dict<string> }>('get_custom_html')
    const [section, setSection] = useState('')
    const [all, setAll] = useState<Dict<string>>({})
    const [saved, setSaved] = useState({})
    useEffect(() => data && setSaved(data?.sections), [data])
    useEffect(() => setAll(saved), [saved])
    const options = useMemo(() => {
        const keys = Object.keys(all)
        if (!keys.includes(section))
            setSection(keys?.[0] || '')
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
            h(SelectField as Field<string>, { label: "Section", value: section, options, onChange: setSection }),
            reloadBtn(reload),
            h(IconBtn, {
                icon: Save,
                title: "Save\n(ctrl+s)",
                sx: modifiedSx(anyChange),
                onClick: save,
            }),
        ),
        h(TextEditor, {
            value: all?.[section] || '',
            style: { background: '#8881' },
            // @ts-ignore TODO
            onChange(v: string) {
                setAll(all => ({ ...all, [section]: v }))
            },
            onKeyDown(ev) {
                if (isCtrlKey(ev) === 's') {
                    save().then()
                    ev.preventDefault()
                }
            },
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

type OP = ComponentProps<typeof Editor>
type Already = 'highlight' | 'padding' | 'tabSize' | 'insertSpaces' | 'ignoreTabKey' | 'onValueChange'
type TextEditorProps = FieldProps<string> & Omit<OP, Already> & Partial<Pick<OP, Already>>
export function TextEditor({ label, helperText, onChange, setApi, style, ...props }: TextEditorProps) {
    return h(Fragment, {},
        label && h(FormLabel, { sx: { ml: 1 } }, label),
        helperText && h(FormHelperText, {}, helperText),
        h(Editor, {
            highlight: escapeHTML,
            padding: 10,
            tabSize: 4,
            insertSpaces: true,
            ignoreTabKey: false,
            style: {
                fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace',
                fontSize: '1em',
                flex: 1,
                background: '#8883',
                borderBottom: '1px solid #bbb',
                ...style,
            },
            onValueChange(v: string) {
                onChange(v, { was: props.value, event: null })
            },
            ...props,
        })
    )
}