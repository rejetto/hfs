import { createTheme, useMediaQuery } from '@mui/material'
import { useMemo } from 'react'

export function useMyTheme() {
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')
    return useMemo(() => createTheme(!prefersDarkMode ? {} : {
        palette: {
            mode: 'dark',
            text: { primary:'#aaa' },
            primary: { main: '#357' },
        },
        components: {
            MuiButton: {
                styleOverrides: {
                    root: ({ ownerState }) =>
                        ownerState.color === 'primary' && {
                            color: ownerState.variant === 'contained' ? '#ddd' : '#68c'
                        }
                }
            }
        }
    }), [prefersDarkMode])
}
