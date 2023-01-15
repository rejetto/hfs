// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Dict, useStateMounted } from './misc'
import { createElement as h, Fragment } from 'react'
import { Button, Grid } from '@mui/material'
import { Field, FieldProps, SelectField } from '@hfs/mui-grid-form'
import _ from 'lodash'
import { useApiEx } from './api'

export default function PermField({ label, value, onChange }: FieldProps<Dict<string> | null> & { keyLabel:string }) {
    const [temp, setTemp] = useStateMounted<string|undefined>(undefined)
    const { data, element } = useApiEx('get_usernames')
    const usernames = data?.list || []

    const permOptions = [{ label:'read', value:'r' }, { label:'none', value:''  }]
    const usernamesLeft = _.difference(usernames, Object.keys(value||{}))

    return h(Grid, { container: true },
        label && h(Grid, { item: true, xs: 12, pl: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
            label,
            !element && h(Button, {
                onClick(event){
                    setTemp(undefined)
                    onChange(null, { event, was: value })
                }
            }, 'Clear')),
        element || h(Fragment, {},
            // existing entries
            Object.entries(value||{}).map(([username, perm]) => [
                h(Grid, { key:'k', item: true, xs: 6 },
                    h(SelectField as Field<string>, {
                        label: 'Username',
                        options: usernames,
                        value: username,
                        onChange(v, { was, ...rest }){
                            const copy: any = { ...value, [v]: value![was!] }
                            delete copy[was!]
                            onChange(copy, { was:value, ...rest })
                        }
                    })),
                h(Grid, { key:'v', item: true, xs: 6 },
                    h(SelectField as Field<string>, {
                        label: 'Access',
                        options: permOptions,
                        value: perm,
                        onChange(v, { was, ...rest }){
                            const copy = { ...value }
                            if (v)
                                copy[username] = v
                            else
                                delete copy[username]
                            onChange( _.isEmpty(copy) ? null : copy, { was:value, ...rest })
                        }
                    })),
            ]),
            // row for new entries
            !usernamesLeft.length && h(Grid, { item: true, xs: 12, py: 1, px: 2, color:'text.secondary' }, "No accounts left"),
            usernamesLeft.length>0 && h(Grid, { item: true, xs: 6 },
                h(SelectField as Field<string>, {
                    label: value ? "Add access to" : "Restrict access to ",
                    value: temp,
                    options: usernamesLeft,
                    onChange: setTemp as any,
                })),
            usernamesLeft.length>0 && h(Grid, { item: true, xs: 6 },
                h(SelectField as Field<string>, {
                    value: undefined,
                    label: temp && "Select access type",
                    disabled: !temp,
                    options: permOptions,
                    onChange(v, rest) {
                        if (v)
                            onChange({ ...value, [temp!]: v }, { ...rest, was: value })
                        setTemp(undefined)
                    }
                }))
        )
    )
}

