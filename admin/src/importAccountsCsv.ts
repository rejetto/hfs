import { alertDialog, formDialog, newDialog } from './dialog'
import { createElement as h, Fragment, useEffect, useState } from 'react'
import { Group, Upload } from '@mui/icons-material'
import { Box } from '@mui/material'
import { apiCall } from './api'
import { apiNewPassword } from './AccountForm'
import { IconProgress, prefix, readFile, selectFiles } from './misc'
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
        const cfg = await formDialog<typeof initialConfig>({
            title: "Import accounts from CSV",
            dialogProps: { maxWidth: 'sm' },
            values: initialConfig,
            form: values => {
                const row = rows[values.skipFirstLines || 0]
                const rec = getRec(row, { ...initialConfig, ...values })
                return {
                    save: { startIcon: h(Upload), children: 'Go' },
                    fields: [
                        h(Box, { p: 1 }, "Total lines:", rows.length),
                        { k: 'skipFirstLines', comp: NumberField, min: 0, max: rows.length-1, typing: true, md: 6,
                            helperText: h(Fragment, {}, "First line: ", h('code', {}, row.join(', ')) ),
                        },
                        { k: 'overwriteExistingAccounts', comp: BoolField, md: 6 },
                        { k: 'usernameColumn', ...colField,
                            helperText: h(Fragment, {}, "First username: ", rec.u),
                        },
                        { k: 'passwordColumn', ...colField,
                            helperText: h(Fragment, {}, "First password: ", rec.p),
                        },
                        { k: 'groupColumn', ...colField,
                            helperText: h(Fragment, {}, "First group: ", rec.g),
                        },
                        { k: 'redirectColumn', ...colField,
                            helperText: h(Fragment, {}, "First redirect: ", rec.r),
                        },
                    ],
                }
            },
        })
        if (!cfg) return
        const close = newDialog({
            title: "Importing...",
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
                        try {
                            let i = 0
                            for (const row of rows) {
                                if (stop) return
                                if (skip) {
                                    skip--
                                    continue
                                }
                                const rec = getRec(row, cfg)
                                setRecord(rec)
                                setProgress(i++ / total)
                                await apiCall('add_account', {
                                    username: rec.u,
                                    belongs: rec.g?.split(','),
                                    redirect: rec.r,
                                    overwrite: cfg.overwriteExistingAccounts
                                }).then(() => {
                                    if (rec.p)
                                        return apiNewPassword(rec.u, rec.p)
                                }, e => {
                                    if (e.code === 409)
                                        return already++
                                    bad++
                                })
                            }
                        }
                        finally {
                            close()
                            const good = total - bad - already
                            const msg = "Results: " + [
                                prefix('', bad, " failed"),
                                prefix('', good, " succeeded"),
                                prefix('', already, " skipped because already present"),
                            ].filter(Boolean).join(', ')
                            alertDialog(msg, !good && bad ? 'error' : (bad || already) ? 'warning' : 'success')
                            cb?.()
                        }
                    })
                    return () => { stop = true }
                }, [])
                return h(Box, { display: 'flex', gap: 2, alignItems: 'center' },
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
