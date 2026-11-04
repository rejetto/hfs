import { createElement as h, useState } from 'react'
import { formDialog, useDialogBarColors } from '../../admin/src/dialog'
import { SwitchThemeBtn } from '../../admin/src/theme'
import { Box, Button } from '@mui/material'

export default function DialogFixture() {
    const colors = useDialogBarColors()
    const [validated, setValidated] = useState('')
    return h(Box, {},
        h(SwitchThemeBtn),
        h('output', { 'data-testid': 'validated' }, validated),
        h(Box, { 'data-testid': 'bar', sx: colors }, 'Dialog colors'),
        h(Button, { onClick: () => formDialog({
            title: 'Validated form',
            values: { name: '' },
            form: (_values, { submit }) => ({
                onValidation(errors, submitting) {
                    if (!errors && !submitting) setValidated(String(_values.name))
                },
                fields: [{ k: 'name', label: 'Name', required: true }],
                save: { children: 'Save and close' },
                addToBar: [h(Button, { key: 'save', onClick: () => submit(() => {}) }, 'Save without closing')],
            }),
        }) }, 'Open form'))
}
