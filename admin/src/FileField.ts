// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { FieldProps, StringField } from '@hfs/mui-grid-form'
import { Eject } from '@mui/icons-material'
import { useDebounce } from 'usehooks-ts'
import { IconBtn, useBreakpoint } from './mui'
import { enforceFinal, getHFS, newDialog, prefix } from '@hfs/shared'
import FilePicker from './FilePicker'
import { apiCall } from './api'
import { t } from './i18n'

export default function FileField({ value, onChange, files=true, folders=false, fileMask, defaultPath, title, helperText, ...props }: FieldProps<string>) {
    const large = useBreakpoint('md')
    const [missingPath, setMissingPath] = useState('')
    const [pathToCheck, setPathToCheck] = useState({ path: '', id: 0 })
    const debounced = useDebounce(pathToCheck, 1000)
    const debouncedPath = debounced.path
    const draftPath = useRef(value)
    const checking = useRef<Promise<unknown>>(Promise.resolve())
    useEffect(() => {
        if (draftPath.current === value) return
        draftPath.current = value
        setPathToCheck(was => ({ path: '', id: was.id + 1 }))
        setMissingPath('')
    }, [value])
    useEffect(() => {
        if (!debouncedPath) return
        let current = true
        // serialize checks so slow filesystem calls cannot overlap or publish stale results
        checking.current = checking.current.then(() => {
            if (!current || draftPath.current !== debouncedPath) return
            return apiCall('resolve_path', { path: debouncedPath }).then(res => {
                if (current && draftPath.current === debouncedPath)
                    setMissingPath(res.isFolder === undefined ? debouncedPath : '')
            }, () => {})
        })
        return () => { current = false }
    }, [debounced])
    return h(StringField, {
        ...props,
        value,
        onChange: change,
        onTyping: check,
        helperText: missingPath && missingPath === draftPath.current ? h(Box as any, { component: 'span' },
            h(Box as any, { component: 'span', sx: { color: 'warning.main', display: 'block' } }, t`Path does not exist`),
            helperText) : helperText,
        wrap: true,
        end: h(IconBtn, {
            icon: Eject,
            title: t`Browse files...`,
            edge: 'end',
            sx: { mb: .5 },
            onClick() {
                const { close } = newDialog({
                    title: title ?? t(files ? "Pick a file" : "Pick a folder") + prefix(': ', fileMask),
                    dialogProps: {
                        fullScreen: !large,
                        sx: { minWidth: 'min(90vw, 40em)', minHeight: 'calc(100vh - 9em)' }
                    },
                    Content() {
                        return h(FilePicker, {
                            multiple: false,
                            folders,
                            files,
                            fileMask,
                            from: value || defaultPath,
                            async onSelect(sel) {
                                let one = sel?.[0]
                                if (!one) return
                                // include the directory boundary without duplicating root separators
                                const cwd = enforceFinal(getHFS().pathSeparator, (await apiCall('get_cwd'))?.path)
                                if (one.startsWith(cwd))
                                    one = one.slice(cwd.length) || '.'
                                change(one, { was: value, event: 'picker' })
                                close()
                            }
                        })
                    },
                })
            },
        })
    })

    function change(next: string, more: Parameters<typeof onChange>[1]) {
        onChange(next, more)
        check(next)
    }

    function check(next: string) {
        if (draftPath.current === next) return next
        draftPath.current = next
        setPathToCheck(was => ({ path: next, id: was.id + 1 }))
        setMissingPath('')
        return next
    }
}
