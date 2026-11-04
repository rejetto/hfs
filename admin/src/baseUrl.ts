import { createElement as h, useState } from 'react'
import { t } from './i18n'
import { Box, MenuItem, MenuList } from '@mui/material'
import { Check, Save } from '@mui/icons-material'
import { Field, SelectField, StringField } from '@hfs/mui-grid-form'
import { apiCall } from './api'
import { CFG, ipForUrl, md, newDialog, prefix, splitAt, stringBefore } from './misc'
import { Btn } from './mui'
import { alertDialog, toast } from './dialog'
import _ from 'lodash'

export async function changeBaseUrl() {
    try {
        const res = await apiCall('get_status')
        const { base_url, roots } = await apiCall('get_config', { only: [CFG.base_url, CFG.roots] })
        const urls: string[] = res.urls.https || res.urls.http
        const domainsFromRoots = Object.keys(roots).map(x => x.split('|')).flat().filter(x => !/[*?]/.test(x))
        const proto = splitAt('//', urls[0])[0] + '//'
        urls.push(..._.difference(domainsFromRoots.map(x => proto + x), urls))
        return await new Promise(resolve => {
            const { close } = newDialog({
                title: t`Main address`,
                Content() {
                    const [v, setV] = useState(base_url || '')
                    const proto = stringBefore('//', v || urls[0]) + '//'
                    const host = urls.includes(v) ? '' : v.slice(proto.length)
                    const check = h(Check, { sx: { ml: 2 } })
                    return h(Box, { sx: { display: 'flex', flexDirection: 'column' } },
                        h(Box, { sx: { mb: 2 } }, t`Choose a main address for your links`),
                        h(MenuList, {},
                            h(MenuItem, {
                                selected: !v,
                                onClick: () => set(''),
                            }, t`Automatic`, !v && check),
                            urls.map(u => h(MenuItem, {
                                key: u,
                                selected: u === v,
                                onClick: () => set(u),
                            }, u, u === v && check))
                        ),
                        h(StringField, {
                            label: t`Custom IP or domain`,
                            helperText: md(t`custom_base_url_warning`),
                            value: host,
                            onChange: v => set(/^\s*https?:\/\//i.test(v) ? v.trim().replace(/^https?:/i, s => s.toLowerCase()) : prefix(proto, ipForUrl(v.trim()))),
                            start: h(SelectField as Field<string>, {
                                value: proto,
                                onChange: v => host ? set(v + host) : toast(t`Enter domain first`),
                                options: ['http://','https://'],
                                size: 'small',
                                variant: 'standard',
                                sx: { '& .MuiSelect-select': { pt: '1px', pb: 0 } },
                            }),
                            sx: { mt: 2 }
                        }),
                        h(Box, { sx: { mt: 2, textAlign: 'right' } },
                            h(Btn, {
                                icon: Save,
                                children: t`Save`,
                                async onClick() {
                                    if (v !== base_url)
                                        await apiCall('set_config', { values: { [CFG.base_url]: v.replace(/\/$/, '') } })
                                    close()
                                    resolve(v)
                                },
                            }) ),
                    )

                    function set(u: string) {
                        if (u.endsWith('/'))
                            u = u.slice(0, -1)
                        setV(u)
                    }
                }
            })
        })
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}
