// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react';
import { Field, SelectField } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { Alert, Box } from '@mui/material'
import { Dict, HTTP_MESSAGES, isCtrlKey, prefix, md, isNumeric, CFG } from './misc'
import { hTooltip, IconBtn, reloadBtn, wikiLink } from './mui'
import { Save } from '@mui/icons-material'
import _ from 'lodash'
import { useDebounce } from 'usehooks-ts'
import { TextEditor } from './TextEditor';
import { state, useSnapState } from './state'
import { PageProps } from './App'
import { switchBtn } from './VerticalSwitch';
import { adminApis } from '../../src/adminApis'

const names: any = {
    top: "Top of HTML Body",
    bottom: "Bottom of HTML Body",
}

export default function CustomHtmlPage({ setTitleSide }: PageProps) {
    const { data, reload } = useApiEx<typeof adminApis.get_custom_html>('get_custom_html')
    const { customHtmlSection: section } = useSnapState()
    const [all, setAll] = useState<Dict<string>>({})
    const [saved, setSaved] = useState({})
    useEffect(() => {
        if (!data) return
        setSaved(data.sections)
        setEnabled(data.enabled)
    }, [data])
    useEffect(() => setAll(saved), [saved])
    const options = useMemo(() => {
        const keys = _.sortBy(Object.keys(all), isNumeric) // http codes at the bottom
        if (keys.length && !keys.includes(section))
            state.customHtmlSection = _.findKey(all, Boolean) || keys?.[0] || '' // prefer any key with content
        return keys.map(x => ({
            value: x,
            label: (names[x] || prefix('HTTP ', HTTP_MESSAGES[x as any]) || _.startCase(x)) + (all[x]?.trim() ? ' *' : '')
        }))
    }, [useDebounce(all, 500)])
    const anyChange = useMemo(() => !_.isEqualWith(saved, all, (a,b) => !a && !b || undefined),
        [saved, all])
    const [enabled, setEnabled] = useState<boolean>()
    setTitleSide(useMemo(() => h(Box, { sx: { display: { xs: 'none', md: 'block' }  } },
        h(Alert, { severity: 'info' },
            md("Add HTML code to some parts of the Front-end. It's saved to file `custom.html`, that you can edit directly with your editor of choice. "),
            wikiLink('customization', "More help")
        ),
        h(Alert, { severity: 'info' }, md("To customize icons "), wikiLink('customization#icons', "read documentation") ),
    ), []))
    return h(Fragment, {},
        h(Box, { display: 'flex', alignItems: 'center', gap: 1, mb: 1 },
            h(SelectField as Field<string>, {
                label: "Section",
                value: section,
                options,
                onChange: v => state.customHtmlSection = v
            }),
            reloadBtn(reload),
            h(IconBtn, {
                icon: Save,
                title: "Save\n(ctrl+enter)",
                modified: anyChange,
                onClick: save,
            }),
            hTooltip("Enable / Disable", undefined, switchBtn(enabled, async v => {
                await apiCall('set_config', { values: { [CFG.disable_custom_html]: !v } })
                setEnabled(v)
            })),
        ),
        h(TextEditor, {
            lang: section === 'style' ? 'css' : section === 'script' ? 'js' : 'html',
            value: all?.[section] || '',
            style: { background: '#8881' },
            onValueChange(v: string) {
                setAll(all => ({ ...all, [section]: v }))
            },
            onKeyDown(ev) {
                if (['s','S','Enter'].includes(isCtrlKey(ev) as any)) {
                    void save()
                    ev.preventDefault()
                }
            },
        }),
    )

    function save() {
        return apiCall('set_custom_html', { sections: all }).then(() => setSaved(all))
    }
}
