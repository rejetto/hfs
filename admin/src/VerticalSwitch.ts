import { createElement as h } from 'react'
import { styled, Switch, SwitchProps } from '@mui/material'

export function switchBtn(value: boolean | undefined, onChange: (v: boolean) => void, props?: SwitchProps) {
    return h(VerticalSwitch, {
        checked: value || false,
        onChange(ev, v) { onChange(v) },
        disabled: value === undefined,
        ...props
    })
}

export const VerticalSwitch = styled(Switch)(({ theme, size }) => {
    const small = size && size === 'small'
    return ({
        height: small ? 36 : 48, width: small ? 18 : 26,
        padding: 5,
        '& .MuiSwitch-switchBase': {
            margin: 1,
            padding: 0,
            transform: `translateY(${small ? 16 : 22}px)`,
            '&.Mui-checked': {
                color: theme.palette.primary.contrastText,
                transform: 'translateY(2px)',
                '& .MuiSwitch-thumb:before': {
                    backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="${small ? 14 : 20}" width="20" viewBox="0 0 20 20"><path fill="${encodeURIComponent(
                        theme.palette.primary.contrastText
                    )}" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>')`,
                },
                '& + .MuiSwitch-track': {
                    backgroundColor: theme.palette.grey[500],
                },
            },
        },
        '& .Mui-checked .MuiSwitch-thumb': {
            backgroundColor: theme.palette.primary.main,
            boxShadow: '0px 2px 1px 1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12)',
        },
        '& .MuiSwitch-thumb': {
            width: small ? 16 : 24,
            height: small ? 16 : 24,
            backgroundColor: theme.palette.grey[700],
            '&::before': {
                content: "''",
                position: 'absolute',
                width: '85%',
                height: '85%',
                left: 0,
                top: 0,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="${small ? 14 : 20}" width="20" viewBox="0 0 20 20"><path fill="${encodeURIComponent(
                    theme.palette.primary.contrastText
                )}" d="M19,13H5V11H19V13Z"/></svg>')`,
            },
        },
        '& .MuiSwitch-track': {
            backgroundColor: theme.palette.grey[500],
            borderRadius: 20 / 2,
        },
    })
})