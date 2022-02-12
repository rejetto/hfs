import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { Box, Card, CardContent, List, ListItem, ListItemText } from '@mui/material'
import { BoolField, DisplayField, Form } from './Form'
import _ from 'lodash'
import { apiCall } from './api'
import { formatBytes, isEqualLax, objSameKeys } from './misc'
import { reloadVfs } from './VfsPage'
import { alertDialog } from './dialog'
import PermField from './PermField'
import { Lock, LockOpen } from '@mui/icons-material'
import md from './md'

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
    const { source } = file
    useEffect(() => setValues(file), [JSON.stringify(file)]) //eslint-disable-line
    const [values, setValues] = useState(file)
    const isDir = file.type === 'folder'
    const realFolder = source && isDir
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
            { k: 'name', helperText: source && "You can decide a name that's different from the one on your disk" },
            source && { k: 'source', comp: DisplayField },
            realFolder && { k: 'hide', xl: values.hide ? 12: 6, label: "Hide elements read from the source",
                helperText: "Entering a file mask you can decide that people won't see some elements in this list, but still can download if they have a direct link to them" },
            realFolder && { k: 'remove', xl: values.hide ? 12: 6, label: "Remove/skip elements read from the source",
                helperText: "Elements matching the specified file mask won't be neither listed nor downloadable, like they don't exist" },
            source && !realFolder && { k: 'size', comp: DisplayField, map: formatBytes },
            source && { k: 'ctime', comp: DisplayField, md: 6, label: 'Created', map: (x:string) => x && new Date(x).toLocaleString() },
            source &&   { k: 'mtime', comp: DisplayField, md: 6, label: 'Modified', map: (x:string) => x && new Date(x).toLocaleString() },
            { k: 'hidden', comp: BoolField, md: 6, helperText: "If you hide this element will not be listed, but will still be accessible if you have a direct link" },
            isDir && { k: 'forbid', comp: BoolField, md: 6, helperText: "Forbid listing the content of this folder, but elements inside will still be accessible if you have a direct link" },
            { k: 'perm', comp: PermField,
                label: h(Box, { display:'flex', gap:1 }, ...values.perm ? [h(Lock), 'Access restricted'] : [h(LockOpen), 'Access not restricted'])
            },
            { k: 'mime', lg: 6, label:"MIME type", helperText: isDir && "Will be applied for all files in this folder" },
            realFolder && { k: 'default', lg: 6, label:"Serve file instead of list",
                helperText: md("If you have a website that you want to serve in this folder, specify `index.html`") },
        ]
    })
}
