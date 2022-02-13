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
