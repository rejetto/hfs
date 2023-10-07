import { ComponentProps, createElement as h, forwardRef, useState } from 'react'
import Editor from 'react-simple-code-editor'
import { FieldProps } from '@hfs/mui-grid-form'
import { Box, TextField, TextFieldProps } from '@mui/material'
import { escapeHTML, focusableSelector, isCtrlKey } from './misc'
import _ from 'lodash'

type OP = ComponentProps<typeof Editor>
type Already = 'highlight' | 'padding' | 'tabSize' | 'insertSpaces' | 'ignoreTabKey'
type TextEditorProps = Omit<OP, Already> & Partial<Pick<OP, Already>>
export const TextEditor = forwardRef(({ style, ...props }: TextEditorProps, ref) => h(Editor, {
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

export function TextEditorField({ onChange, value, onBlur, setApi, ...props }: FieldProps<string> & Omit<TextFieldProps, 'onChange'>) {
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
            props.onKeyDown?.(ev)
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