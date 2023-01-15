// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import React, { createElement as h, useCallback } from 'react'
import { Button, Menu, MenuItem } from '@mui/material'

interface Props { items: any[], [rest:string]:any }

export default function MenuButton({ items, ...rest }: Props) {
    const [anchorEl, setAnchorEl] = React.useState<HTMLElement>()
    const open = Boolean(anchorEl)
    const onClose = useCallback(() => setAnchorEl(undefined), [])
    return h(React.Fragment, {},
        h(Button, {
            'aria-controls': open ? 'basic-menu' : undefined,
            'aria-haspopup': 'true',
            'aria-expanded': open ? 'true' : undefined,
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                setAnchorEl(event.currentTarget)
            },
            ...rest,
        }),
        h(Menu, {
            anchorEl,
            open,
            onClose,
            MenuListProps: { 'aria-labelledby': 'basic-button' },
            children: items.map((it,idx) =>
                h(MenuItem, {
                    key: idx,
                    ...it,
                    onClick() {
                        onClose()
                        it.onClick?.apply(this, arguments)
                    }
                }) )
        })
    )
}
