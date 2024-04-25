import { DateTimePicker } from '@mui/x-date-pickers'
import dayjs from 'dayjs'
import { FieldProps } from '@hfs/mui-grid-form'
import { createElement as h } from 'react'
import { Box, FormHelperText } from '@mui/material'
import { isTimestampString, objSameKeys } from './misc'

export function DateTimeField({ onChange, error, helperText, ...rest }: FieldProps<Date>) {
    return h(Box, {},
        h(DateTimePicker, {
            ...objSameKeys(rest, x => isTimestampString(x) || x && x instanceof Date ? dayjs(x) : (x ?? null)), // null to not be considered uncontrolled
            sx: { width: '100%', color: 'error.main', ...rest.sx },
            onChange(v: any) {
                onChange(v && new Date(v), { was: rest.value, event: undefined })
            },
            slotProps: { // under 400, not all buttons fit, so we sacrifice 'cancel' as you can  still tap outside the dialog
                actionBar: { actions: ['clear', ...window.innerWidth < 400 ? [] : ['cancel'] as const, 'today', 'accept'] }
            }
        }),
        helperText && h(FormHelperText, { error }, helperText),
    )
}
