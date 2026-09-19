// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { createElement as h, useEffect, useState } from 'react'
import { language, t } from './i18n'
import { Box, Table, TableBody, TableCell, TableRow } from '@mui/material'
import { DataTable, DataTableColumn } from './DataTable'
import {
    Delete, FormatPaint as ThemeIcon, ListAlt, PlayCircle, Settings, StopCircle, Upgrade
} from '@mui/icons-material'
import {
    CFG, HTTP_FAILED_DEPENDENCY, md, xlate, isPrimitive, HIDE_IN_TESTS, wait
} from './misc'
import { confirmDialog, toast } from './dialog'
import _ from 'lodash'
import { PLUGIN_ERRORS, pluginName, renderPluginName, startPlugin } from './plugin'
import { Btn, IconBtn, iconTooltip, usePauseButton } from './mui'
import { parsePluginConfig, showPluginOptions } from './pluginOptions'

// updates=true will show the "check updates" version of the page
export default function InstalledPlugins({ updates }: { updates?: true }) {
    const { list, error, setList, initializing } = useApiList<any>(updates ? 'get_plugin_updates' : 'get_plugins', {}, {
        map: parsePluginConfig, reconnectGraceSeconds: 60,
    })
    const [sortAgain, setSortAgain] = useState(0)
    useEffect(() => {
        setList(list =>
            _.sortBy(list, x => (x.error ? 0 : x.started ? 1 : x.badApi ? 2 : 3) + pluginName(x.repo?.split('/').reverse().join('/') || x.id).toLowerCase()))
    }, [list.length, sortAgain])
    const size = 'small'
    const { pause, pauseButton } = usePauseButton("plugins", () => getSingleConfig(CFG.suspend_plugins).then(x => !x), {
        async onClick() {
            await apiCall('set_config', { values: { [CFG.suspend_plugins]: !pause } })
            if (!pause) return
            await wait(2000)
            setSortAgain(Date.now())
        }
    })
    return h(DataTable, {
        error: isPrimitive(error) ? xlate(error, PLUGIN_ERRORS)
            : _.map(error, (v, k) => `Error ${k} for: ${v.join(', ')}`).join('; '), // complex error for updates
        rows: list.length ? list : [], // workaround for DataGrid's bug causing 'no rows' message to be not displayed after 'loading' was also used
        fillFlex: true,
        initializing,
        disableColumnSelector: true,
        quickFilter: !updates,
        actionsHeader: !updates && pauseButton,
        getRowHeight: updates && (({ model }) => model.changelog ? 'auto' as const : 50),
        noRows: updates && t`plugin_updates_scope_notice`,
        columns: [
            {
                field: 'id',
                headerName: t`Name`,
                flex: .3,
                minWidth: 150,
                renderCell: renderPluginName,
                valueGetter(_value: any, row: any) { return row.repo || row.id },
                mergeRender: { [updates ? 'changelog' : 'description']: { sx: { fontSize: 'x-small' } } }
            },
            {
                field: 'version', headerName: t`Version`,
                width: 70,
                hideUnder: 'sm',
                cellInnerProps: { className: HIDE_IN_TESTS },
                mergeRender: { installedVersion: { sx: { fontSize: 'x-small' } } }
            },
            themeField,
            {
                ...descriptionField,
                flex: 1,
                hideUnder: 'sm',
            },
            {
                field: 'installedVersion', headerName: t`Installed version`,
                hideUnder: true,
                dialogHidden: true,
                renderCell: ({ value }) => value && t('installed_version_value', { version: value })
            },
            {
                field: 'changelog',
                headerName: t`Change log`,
                flex: 2,
                hideUnder: !updates || 'sm',
                sx: { flexDirection: 'column', alignItems: 'flex-start' },
                renderCell({ value, row }) {
                    if (!Array.isArray(value)) return null
                    return h(Table, { sx: { td: { p: 0 } } },
                        h(TableBody, {},
                            _.uniq(_.sortBy(value, 'version').filter(x => _.isString(x.message) && x.message && x.version > row.installedVersion))
                                .map((x, i) => h(TableRow, { key: i },
                                    h(TableCell, { sx: { whiteSpace: 'pre', verticalAlign: 'top' } }, `• ${x.version}: `),
                                    h(TableCell, {}, md(x.message, { html: false }))
                                ))
                        )
                    )
                }
            }
        ],
        actions: ({ row, id }) => updates ? [
            h(IconBtn, {
                icon: Upgrade,
                title: row.downloading ? t`Downloading` : row.updated ? t`Already updated` : t`Update`,
                disabled: row.updated,
                progress: row.downloading,
                size,
                async onClick() {
                    await apiCall('update_plugin', { id }, { timeout: false }).catch(e => {
                        throw e.code !== HTTP_FAILED_DEPENDENCY ? e
                            : Error(t('failed_plugin_dependencies', { dependencies: e.cause?.map((x: any) =>
                                t('plugin_dependency_error', { pluginId: x.id || x.repo, error: x.error })).join('; ') }))
                    })
                    toast(t`Plugin updated`)
                }
            })
        ] : [
            h(IconBtn, row.started ? {
                icon: StopCircle,
                title: h(Box, { 'aria-hidden': true }, t("Stop {id}", { id: id }), h('br'), t('started_at', { startedAt: new Date(row.started as string).toLocaleString(language) })),
                'aria-label': t("Stop {id}", { id: id }),
                size,
                color: 'success',
                doneAnimation: true,
                onClick: () => apiCall('stop_plugin', { id }),
            } : {
                icon: PlayCircle,
                title: t("Start {id}", { id: id }),
                disabled: pause && t`All plugins are paused – Click the Resume button below`,
                size,
                onClick: () => startPlugin(id),
            }),
            h(IconBtn, {
                icon: row.config || !row.started || !row.log ? Settings : ListAlt,
                title: row.config || !row.log ? t`Options` : t`Log`,
                size,
                disabled: !row.started && t`Start plugin to access options`
                    || !row.config && !row.log && t`No options and no log for this plugin`,
                onClick() {
                    return showPluginOptions(row)
                }
            }),
            h(IconBtn, {
                icon: Delete,
                title: t`Uninstall`,
                size,
                async onClick() {
                    const res = await confirmDialog(t("{id}: delete configuration too?", { id: id }), {
                        trueText: t`Yes`,
                        falseText: t`No`,
                        after: ({ onClick }) => h(Btn, { variant: 'outlined', onClick(){ onClick(undefined) } }, t`Abort`)
                    })
                    if (res === undefined) return
                    await apiCall('uninstall_plugin', { id, deleteConfig: res })
                    toast(t`Plugin uninstalled`)
                }
            }),
        ]
    })
}

function getSingleConfig(k: string) {
    return apiCall('get_config', { only: [k] }).then(x => x[k])
}

export const descriptionField: DataTableColumn = {
                field: 'description', headerName: t`Description`,
    mergeRender: { isTheme: {} } ,
    mergeRenderSx: { float: 'left' },
}

export const themeField: DataTableColumn = {
    field: 'isTheme',
    headerName: t`is theme`,
    hideUnder: true,
    dialogHidden: true,
    type: 'boolean',
    renderCell({ value }) {
        return value && iconTooltip(ThemeIcon, _.isString(value) ? t('named_theme', { themeName: value }) : t`theme`, { fontSize: '1.2rem', mr: '.3em' })
    }
}
