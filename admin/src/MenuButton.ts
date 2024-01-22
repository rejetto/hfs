// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { MouseEvent, createElement as h, Fragment, useCallback, useId, useState } from 'react'
import { Button, ButtonProps, Menu, MenuItem } from '@mui/material'

interface Props extends ButtonProps { items: any[] }

export default function MenuButton({ items, ...rest }: Props) {
    const [anchorEl, setAnchorEl] = useState<HTMLElement>()
    const open = Boolean(anchorEl)
    const onClose = useCallback(() => setAnchorEl(undefined), [])
    const id = useId()
    const menuId = useId()
    return h(Fragment, {},
        h(Button, {
            id,
            'aria-controls': open ? menuId : undefined,
            'aria-haspopup': true,
            'aria-expanded': open ? true : undefined,
            onClick(event: MouseEvent<HTMLButtonElement>) {
                setAnchorEl(event.currentTarget)
            },
            ...rest,
        }),
        h(Menu, {
            id: menuId,
            anchorEl,
            open,
            onClose,
            MenuListProps: { 'aria-labelledby': id },
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
