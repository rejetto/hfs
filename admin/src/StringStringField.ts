// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { makeStyles } from '@mui/styles'
import { Dict } from './misc'
import { createElement as h, useEffect, useRef } from 'react'
import { Grid, IconButton } from '@mui/material'
import { Add, Delete } from '@mui/icons-material'
import { FieldProps, StringField } from './Form'

const useStyles = makeStyles({
    tableHeader: {
        padding: '.5em 1em',
        fontWeight: 'bold',
    },
    actions: {
        display: 'flex',
    }
})

export default function StringStringField({ value, onChange, keyLabel='key', valueLabel='value', keyWidth=5, valueWidth=5, actionsWidth=1 }: FieldProps<Dict<string>> & { keyLabel:string }) {
    const refNew = useRef()
    const justEntered = useRef<any>()
    useEffect(() => justEntered.current?.focus?.(),
        [justEntered.current]) //eslint-disable-line
    const styles = useStyles()
    return h(Grid, { container: true },
        // header
        h(Grid, { item: true, xs:keyWidth, className: styles.tableHeader }, keyLabel),
        h(Grid, { item: true, xs:valueWidth, className: styles.tableHeader }, valueLabel),
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
                    inputRef: justEntered.current === id ? justEntered : undefined,
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
            h(Grid, { key:'actions', item: true, xs: actionsWidth, className: styles.actions },
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
                    justEntered.current = v
                    onChange({ ...value, [v]:'' }, { ...more, was:value })
                }
            })),
        h(Grid, { item: true, xs: valueWidth, },
            h(StringField, {
                value: '',
                onChange(){},
                onFocus() { //@ts-ignore
                    setTimeout(()=> refNew.current.focus()) // without setTimeout TextField component is in an inconsistent focus-state
                }
            })),
    )
}

