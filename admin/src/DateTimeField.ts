import { DateTimePicker } from '@mui/x-date-pickers'
import dayjs from 'dayjs'
import { FieldProps } from '@hfs/mui-grid-form'
import { createElement as h } from 'react'
import { Box, FormHelperText } from '@mui/material'
import { objSameKeys } from './misc'

export function DateTimeField({ onChange, error, helperText, ...rest }: FieldProps<Date>) {
    return h(Box, {},
        h(DateTimePicker, {
            ...objSameKeys(rest, x => x && x instanceof Date ? dayjs(x) : (x ?? null)), // null to not be considered uncontrolled
            sx: { width: '100%', color: 'error.main', ...rest.sx },
            onChange(v: any) {
                onChange(v && new Date(v), { was: rest.value, event: undefined })
            }
        }),
        helperText && h(FormHelperText, { error }, helperText),
    )
}

