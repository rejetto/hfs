// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ComponentProps, createElement as h, forwardRef, Fragment, useEffect, useMemo, useState } from 'react';
import { Field, FieldProps, SelectField } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { Alert, Box, TextField } from '@mui/material'
import Editor from 'react-simple-code-editor'
import { Dict, escapeHTML, focusableSelector, IconBtn, isCtrlKey, modifiedSx, reloadBtn, wikiLink } from './misc';
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
                title: "Save\n(ctrl+enter)",
                sx: modifiedSx(anyChange),
                onClick: save,
            }),
        ),
        h(TextEditor, {
            value: all?.[section] || '',
            style: { background: '#8881' },
            onValueChange(v: string) {
                setAll(all => ({ ...all, [section]: v }))
            },
            onKeyDown(ev) {
                if (['s','Enter'].includes(isCtrlKey(ev) as any)) {
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

type OP = ComponentProps<typeof Editor>
type Already = 'highlight' | 'padding' | 'tabSize' | 'insertSpaces' | 'ignoreTabKey'
type TextEditorProps = Omit<OP, Already> & Partial<Pick<OP, Already>>
const TextEditor = forwardRef(({ style, ...props }: TextEditorProps, ref) => h(Editor, {
    // Editor component doesn't seem to support ref, but I didn't cause any problem yet
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
    ...props,
}))

export function TextEditorField({ onChange, value, onBlur, setApi, ...props }: FieldProps<string>) {
    const [state, setState] = useState(value || '')
    return h(TextField, {
        multiline: true,
        fullWidth: true,
        value: state,
        InputProps: { inputComponent: TextEditorAsInput },
        onChange(event) { setState(event.target.value) },
        onBlur(event) {
            onBlur?.(event)
            onChange(event.target.value, { was: value, event })
        },
        ...props,
        onKeyDown(ev) {
            if (isCtrlKey(ev) === 'Enter')
                return onChange(state, { was: value, event: ev })
            if (!ev.altKey || ev.key !== 'Tab') return
            ev.preventDefault()
            const focusable = document.querySelectorAll(focusableSelector)
            const i = _.indexOf(focusable, ev.target)
            const n = focusable.length
            const next = (i + (ev.shiftKey ? -1 : 1) + n) % n
            ;(focusable[next] as HTMLElement).focus()
            console.debug(focusable[next])
        },
    })
}

const TextEditorAsInput = forwardRef<HTMLInputElement, any>(({ onChange, ...rest }: any, ref) =>
    h(Box, { sx: { width: '100%', textarea: { outline: 0 } } },
        h(TextEditor, {
            ref,
            padding: 2,
            style: { background: 'initial', borderBottom: 'initial' },
            ...rest,
            onValueChange: value => onChange({ target: { value } }),
            onKeyDown(ev) {
                if (isCtrlKey(ev) === 'Enter')
                    ev.preventDefault()
            },
        })
    ))