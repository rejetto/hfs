import { alertDialog, formDialog, newDialog } from './dialog'
import { createElement as h, Fragment, useEffect, useState } from 'react'
import { t } from './i18n'
import { Group, Upload } from '@mui/icons-material'
import { Box } from '@mui/material'
import { apiCall } from './api'
import { apiNewPassword, HTTP_CONFLICT, readFile, selectFiles } from './misc'
import { IconProgress } from './mui'
import { NumberField, BoolField } from '@hfs/mui-grid-form'
import Parser from '@gregoranders/csv';

export async function importAccountsCsv(cb?: () => void) {
    selectFiles(async list => {
        const f = list?.[0]
        if (!f) return
        const txt = await readFile(f)
        if (!txt) return
        const parser = new Parser()
        const rows = parser.parse(txt.trim())
        const colField = { comp: NumberField, min: 1, max: 9, xs: 6, typing: true, }
        const initialConfig = {
            skipFirstLines: 0,
            usernameColumn: 1,
            passwordColumn: 2,
            groupColumn: 3,
            redirectColumn: 4,
            overwriteExistingAccounts: false,
        }
        const cfg = await formDialog<typeof initialConfig, typeof initialConfig>({
            title: t`Import accounts from CSV`,
            dialogProps: { maxWidth: 'sm' },
            values: initialConfig,
            form: values => {
                // preview renders before invalid input is rejected by validation
                const row = rows[values.skipFirstLines || 0] || []
                const rec = getRec(row, { ...initialConfig, ...values })
                return {
                    save: { startIcon: h(Upload), children: t`Go` },
                    fields: [
                        h(Box, { sx: { p: 1 } }, t`Total lines:`, rows.length),
                        { k: 'skipFirstLines', label: t`Skip First Lines`, comp: NumberField, max: rows.length-1, typing: true, md: 6,
                            getError: value => value != null && !Number.isInteger(value) && "Enter an integer",
                            helperText: h(Fragment, {}, t`First line: `, h('code', {}, row.join(', ')) ),
                        },
                        { k: 'overwriteExistingAccounts', label: t`Overwrite Existing Accounts`, comp: BoolField, md: 6 },
                        { k: 'usernameColumn', label: t`Username Column`, ...colField,
                            helperText: h(Fragment, {}, t`First username: `, rec.u),
                        },
                        { k: 'passwordColumn', label: t`Password Column`, ...colField,
                            helperText: h(Fragment, {}, t`First password: `, rec.p),
                        },
                        { k: 'groupColumn', label: t`Group Column`, ...colField,
                            helperText: h(Fragment, {}, t`First group: `, rec.g),
                        },
                        { k: 'redirectColumn', label: t`Redirect Column`, ...colField,
                            helperText: h(Fragment, {}, t`First redirect: `, rec.r),
                        },
                    ],
                }
            },
        })
        if (!cfg) return
        const { close } = newDialog({
            title: t`Importing...`,
            Content() {
                const [progress, setProgress] = useState(0)
                const [record, setRecord] = useState<undefined | ReturnType<typeof getRec>>()
                useEffect(() => {
                    let stop = false
                    setTimeout(async () => {
                        if (stop) return
                        let bad = 0
                        let already =0
                        let skip = cfg.skipFirstLines
                        const total = rows.length - skip
                        let worked = 0
                        try {
                            for (const row of rows) {
                                if (stop) return
                                if (skip) {
                                    skip--
                                    continue
                                }
                                const rec = getRec(row, cfg)
                                setRecord(rec)
                                setProgress(worked++ / total)
                                await apiCall('add_account', {
                                    username: rec.u,
                                    belongs: rec.g?.split(','),
                                    redirect: rec.r,
                                    overwrite: cfg.overwriteExistingAccounts
                                }).then(() => {
                                    if (rec.p)
                                        return apiNewPassword(rec.u, rec.p)
                                }).catch(e => {
                                    if (e.code === HTTP_CONFLICT)
                                        return already++
                                    bad++
                                })
                            }
                        }
                        finally {
                            close()
                            const good = worked - bad - already
                            const msg = [
                                t`Results:`,
                                t('account_import_failed', { n: bad }),
                                t('account_import_succeeded', { n: good }),
                                t('account_import_skipped_existing', { n: already }),
                            ].join('\n')
                            alertDialog(msg, !good && bad ? 'error' : (bad || already) ? 'warning' : 'success')
                            cb?.()
                        }
                    })
                    return () => { stop = true }
                }, [])
                return h(Box, { sx: { display: 'flex', gap: 2, alignItems: 'center' } },
                    h(IconProgress, { icon: Group, progress }),
                    record?.u,
                )
            }
        })

        function getRec(row: string[], config: typeof initialConfig) {
            return {
                u: row[config.usernameColumn - 1],
                p: row[config.passwordColumn - 1],
                g: row[config.groupColumn - 1],
                r: row[config.redirectColumn - 1],
            }
        }
    }, { multiple: false, accept: '.csv' })
}
