import { createElement as h } from 'react'
import { formDialog, useDialogBarColors } from '../../admin/src/dialog'
import { SwitchThemeBtn } from '../../admin/src/theme'
import { Box, Button } from '@mui/material'

export default function DialogFixture() {
    const colors = useDialogBarColors()
    return h(Box, {},
        h(SwitchThemeBtn),
        h(Box, { 'data-testid': 'bar', sx: colors }, 'Dialog colors'),
        h(Button, { onClick: () => formDialog({
            title: 'Validated form',
            values: { name: '' },
            form: (_values, { submit }) => ({
                fields: [{ k: 'name', label: 'Name', required: true }],
                save: { children: 'Save and close' },
                addToBar: [h(Button, { key: 'save', onClick: () => submit(() => {}) }, 'Save without closing')],
            }),
        }) }, 'Open form'))
}
