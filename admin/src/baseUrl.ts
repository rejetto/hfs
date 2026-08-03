import { createElement as h, useState } from 'react'
import { Box, MenuItem, MenuList } from '@mui/material'
import { Check, Save } from '@mui/icons-material'
import { Field, SelectField, StringField } from '@hfs/mui-grid-form'
import { apiCall } from './api'
import { CFG, ipForUrl, md, newDialog, prefix, splitAt, stringBefore } from './misc'
import { Btn } from './mui'
import { toast } from './dialog'
import _ from 'lodash'

export async function changeBaseUrl() {
    return new Promise(async resolve => {
        const res = await apiCall('get_status')
        const { base_url, roots } = await apiCall('get_config', { only: [CFG.base_url, CFG.roots] })
        const urls: string[] = res.urls.https || res.urls.http
        const domainsFromRoots = Object.keys(roots).map(x => x.split('|')).flat().filter(x => !/[*?]/.test(x))
        const proto = splitAt('//', urls[0])[0] + '//'
        urls.push(..._.difference(domainsFromRoots.map(x => proto + x), urls))
        const { close } = newDialog({
            title: "Main address",
            Content() {
                const [v, setV] = useState(base_url || '')
                const proto = stringBefore('//', v || urls[0]) + '//'
                const host = urls.includes(v) ? '' : v.slice(proto.length)
                const check = h(Check, { sx: { ml: 2 } })
                return h(Box, { sx: { display: 'flex', flexDirection: 'column' } },
                    h(Box, { sx: { mb: 2 } }, "Choose a main address for your links"),
                    h(MenuList, {},
                        h(MenuItem, {
                            selected: !v,
                            onClick: () => set(''),
                        }, "Automatic", !v && check),
                        urls.map(u => h(MenuItem, {
                            key: u,
                            selected: u === v,
                            onClick: () => set(u),
                        }, u, u === v && check))
                    ),
                    h(StringField, {
                        label: "Custom IP or domain",
                        helperText: md("You can type any address but *you* are responsible to make the address work.\nThis functionality is just to help you copy the link in case you have a domain or a complex network configuration."),
                        value: host,
                        onChange: v => set(prefix(proto, ipForUrl(v))),
                        start: h(SelectField as Field<string>, {
                            value: proto,
                            onChange: v => host ? set(v + host) : toast("Enter domain first"),
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
                            children: "Save",
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
