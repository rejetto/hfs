import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { Card, CardContent, List, ListItem, ListItemText } from '@mui/material'
import { BoolField, DisplayField, Form } from './Form'
import _ from 'lodash'
import { apiCall } from './api'
import { formatBytes, isEqualLax, objSameKeys } from './misc'
import { reloadVfs } from './VfsPage'
import { alertDialog } from './dialog'
import PermField from './PermField'

export default function FileCard() {
    const { selectedFiles: files } = useSnapState()
    const file = files[0]
    if (!file)
        return null
    return h(Card, {},
        h(CardContent, {},
            files.length === 1 ? h(FileForm, { file })
                : h(List, {},
                    files.length + ' selected',
                    files.map(f => h(ListItem, { key: f.name },
                        h(ListItemText, { primary: f.name, secondary: f.source }) )))
        ))
}

function FileForm({ file }:any) {
    file = _.omit(file, ['parent', 'children'])
    useEffect(() => setValues(file), [JSON.stringify(file)]) //eslint-disable-line
    const [values, setValues] = useState(file)
    const realFolder = file.source && file.type === 'folder'
    return h(Form, {
        values,
        set(v, { k }) {
            setValues({ ...values, [k]: v })
        },
        save: {
            disabled: isEqualLax(values, file),
            async onClick() {
                if (!values.name)
                    return alertDialog(`Name cannot be empty`, 'warning')
                const props = objSameKeys(values, (v,k) =>
                    v === file[k] ? undefined : v)
                delete props.source
                await apiCall('set_vfs', {
                    uri: values.id,
                    props,
                })
                if (props.name) // when the name changes, the id of the selected file is changing too, and we have to update it in the state if we want it to be correctly re-selected after reload
                    state.selectedFiles[0].id = file.id.slice(0, -file.name.length) + props.name
                reloadVfs()
            }
        },
        fields: [
            { k: 'name' },
            { k: 'source', comp: DisplayField },
            realFolder && { k: 'hide', xl: values.hide ? 12: 6, label: "Hide elements read from the source" },
            realFolder && { k: 'remove', xl: values.hide ? 12: 6, label: "Remove/skip elements read from the source" },
            { k: 'size', comp: DisplayField, map: formatBytes },
            { k: 'ctime', comp: DisplayField, md: 6, label: 'Created', map: (x:string) => x && new Date(x).toLocaleString() },
            { k: 'mtime', comp: DisplayField, md: 6, label: 'Modified', map: (x:string) => x && new Date(x).toLocaleString() },
            { k: 'hidden', comp: BoolField, md: 6 },
            { k: 'forbid', comp: BoolField, md: 6 },
            { k: 'perm', comp: PermField, label: values.perm ? 'Access restricted' : 'Access not restricted' },
            { k: 'mime', lg: 6, label:"MIME type" },
            realFolder && { k: 'default', lg: 6, label:"Serve file instead of list" },
        ]
    })
}
