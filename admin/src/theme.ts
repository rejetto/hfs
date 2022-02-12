import { createTheme, useMediaQuery } from '@mui/material'
import { useMemo } from 'react'

export function useMyTheme() {
    const lightMode = useMediaQuery('(prefers-color-scheme: dark)') ? null : {}
    return useMemo(() => createTheme({
        palette: lightMode || {
            mode: 'dark',
            text: { primary: '#aaa' },
            primary: { main: '#357' },
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
