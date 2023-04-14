// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createTheme, useMediaQuery } from '@mui/material'
import { useMemo } from 'react'

export function useDark() {
    return useMediaQuery('(prefers-color-scheme: dark)')
}

const EMPTY = {}
export function useMyTheme() {
    const lightMode = useDark() ? null : EMPTY
    return useMemo(() => createTheme({
        palette: lightMode || {
            mode: 'dark',
            text: { primary: '#bbb' },
            primary: { main: '#469', light: '#68c' },
            secondary: { main: '#969' },
        },
        typography: {
            fontFamily: 'Roboto, "Noto sans", "Segoe UI", "San Francisco", "Helvetica Neue", Arial, sans-serif'
        },
        components: {
            MuiLink: {
                defaultProps: lightMode || { color: 'primary.light' }, // primary.main too dark for dark theme
            },
            MuiTextField: {
                defaultProps: { variant: 'filled' },
                styleOverrides: lightMode || {
                    root: { '& label.Mui-focused': { color: '#ccc' } } // our primary.main is too dark for mui's dark theme, and when input element is :-webkit-autofill it will make not enough contrast
                }
            },
            MuiButton: {
                defaultProps: { variant: 'outlined' },
                styleOverrides: lightMode || {
                    root({ ownerState }) {
                        return ownerState.color === 'primary' && {
                            color: ownerState.variant === 'contained' ? '#ddd' : '#68c'
                        }
                    }
                }
            }
        }
    }), [lightMode])
}
