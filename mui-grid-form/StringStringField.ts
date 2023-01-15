// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useRef } from 'react'
import { Grid, IconButton } from '@mui/material'
import { Add, Delete } from '@mui/icons-material'
import { FieldProps} from '.'
import { StringField } from './StringField'

export function StringStringField({ value, onChange, keyLabel='key', valueLabel='value', keyWidth=5, valueWidth=5, actionsWidth=1 }: FieldProps<Record<string,string>> & { keyLabel:string }) {
    const refNew = useRef()
    const justEntered = useRef<any>()
    const tableHeader = {
        padding: '.5em 1em',
        fontWeight: 'bold',
    }
    return h(Grid, { container: true },
        // header
        h(Grid, { item: true, xs:keyWidth, sx: tableHeader }, keyLabel),
        h(Grid, { item: true, xs:valueWidth, sx: tableHeader }, valueLabel),
        h(Grid, { item: true, xs:actionsWidth },
            h(IconButton, {
                onClick() { // @ts-ignore
                    refNew.current.focus()
                }
            }, h(Add))),
        // existing entries
        Object.entries(value||{}).map(([id,v]) => [
            h(Grid, { key:'k', item: true, xs: keyWidth, },
                h(StringField, {
                    value: id,
                    onChange(v, { was, ...rest }){
                        const copy = { ...value }
                        if (v)
                            copy[v] = was !== undefined ? copy[was] : ''
                        if (was !== undefined)
                            delete copy[was]
                        onChange(copy, { was:value, ...rest })
                    }
                })),
            h(Grid, { key:'v', item: true, xs: valueWidth, },
                h(StringField, {
                    inputRef(el: HTMLInputElement) {
                        if (justEntered.current !== id) return
                        el?.focus()
                        justEntered.current = null
                    },
                    value: v,
                    onChange(v, { was, ...rest }){
                        const copy = { ...value }
                        if (v)
                            copy[id] = v
                        else
                            delete copy[id]
                        onChange(copy, { was:value, ...rest })
                    }
                })),
            h(Grid, { key:'actions', item: true, xs: actionsWidth, sx: { display: 'flex' } },
                h(IconButton, {
                    onClick(event){
                        const copy = { ...value }
                        delete copy[id]
                        onChange(copy, { was:value, event })
                    }
                }, h(Delete)))
        ]),
        // empty row for adding
        h(Grid, { item: true, xs: keyWidth, },
            h(StringField, {
                inputRef: refNew,
                value: '',
                onChange(v, more){
                    if (!v) return
                    more.cancel()
                    if (value && v in value)
                        return alert(keyLabel + " entry already present")
                    justEntered.current = v // the way dom is manipulated will cause focus on wrong element, so we have to re-focus
                    onChange({ ...value, [v]:'' }, { ...more, was:value })
                }
            })),
        h(Grid, { item: true, xs: valueWidth, },
            h(StringField, {
                value: '',
                onChange(){},
                disabled: true,
            })),
    )
}

