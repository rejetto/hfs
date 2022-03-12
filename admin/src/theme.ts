// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createTheme, useMediaQuery } from '@mui/material'
import { useMemo } from 'react'

const EMPTY = {}
export function useMyTheme() {
    const lightMode = useMediaQuery('(prefers-color-scheme: dark)') ? null : EMPTY
    return useMemo(() => createTheme({
        palette: lightMode || {
            mode: 'dark',
            text: { primary: '#bbb' },
            primary: { main: '#469' },
        },
        components: {
            MuiTextField: {
                defaultProps: { variant: 'filled' }
            },
            MuiButton: lightMode || {
                styleOverrides: {
                    root: ({ ownerState }: { ownerState:any }) =>
                        ownerState.color === 'primary' && {
                            color: ownerState.variant === 'contained' ? '#ddd' : '#68c'
                        }
                }
            }
        }
    }), [lightMode])
}
