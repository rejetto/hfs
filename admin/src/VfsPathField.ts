import { dirname } from './misc'
import { useApiList } from './api'
import { createElement as h, useMemo } from 'react'
import { Autocomplete, AutocompleteProps, TextField } from '@mui/material'
import { FieldProps } from '@hfs/mui-grid-form'

interface VfsPathFieldProps extends FieldProps<string> {
    autocompleteProps: Partial<AutocompleteProps<string, false, true, undefined>>
}

export default function VfsPathField({ value='', onChange, helperText, setApi, autocompleteProps, onlyFolders=true, ...props }: VfsPathFieldProps) {
    const uri = dirname(value)
    const { list, loading } = useApiList('get_file_list', { uri, admin: true, onlyFolders })
    const options = useMemo(() => [uri + '/'].concat(list.map(x => value + x.n)), [list, uri])
    return h(Autocomplete<string, false, true, undefined>, {
        value,
        options,
        isOptionEqualToValue: (o,v) => o === v || o === v + '/',
        loading,
        disableClearable: true,
        renderInput: params => h(TextField, {
            helperText,
            placeholder: "home",
            onChange(event) {
                const v = event.target.value
                if (v.endsWith('/') || !v)
                    onChange(v, { was: value, event })
            },
            onBlur(event) {
                const v = event.target.value + '/'
                if (options.includes(v))
                    onChange(v, { was: value, event })
            },
            ...params,
            ...props,
            InputLabelProps: { shrink: true, ...params.InputLabelProps, ...props.InputLabelProps },
        }),
        onChange: (event, sel) => onChange(sel, { was: value, event }),
        ...autocompleteProps,
    })
}