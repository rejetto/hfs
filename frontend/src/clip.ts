import { createElement as h, Fragment } from 'react'
import { DirList, state, useSnapState } from './state'
import { Btn } from './components'
import { t, useI18N } from './i18n'
import { alertDialog, toast } from './dialog'
import { useNavigate } from 'react-router-dom'
import { dirname, HTTP_MESSAGES, xlate } from '../../src/cross'
import { apiCall } from '@hfs/shared/api'
import { reloadList, usePath } from './useFetchList'
import _ from 'lodash'

export function ClipBar() {
    const { clip, props } = useSnapState()
    const { t } = useI18N()
    const go = useNavigate()
    const here =  usePath()
    if (!clip.length)
        return null
    const there = dirname(clip[0].uri) + '/'
    return h('div', { id: 'clipBar' },
        h(Btn, { label: t('clipboard', { content: t('n_items', { n: clip.length }, "{n,plural, one{# item} other{# items}}"), }, `Clipboard ({content})`),
            onClick: show, style: { flex: 1 } }),
        h(Btn, { label: t`Paste`, icon: 'paste', onClick: paste, disabled: here === there || !props?.can_upload }),
        h(Btn, { label: t`Cancel clipboard`, icon: 'close', onClick: cancel }),
        h(Btn, { label: t('to_clipboard_source', "Back to source folder"), icon: 'parent', onClick: goBack, disabled: here === there,
            tooltip: t('to_clipboard_source_tooltip', "Go to the folder where the clipboard contents are located"),
        }),
    )

    function cancel() {
        cut([])
    }

    function goBack() {
        go(there)
    }

    function show() {
        alertDialog(h('div', { id: 'clipboard-content' },
            t('clipboard_list', "Items in clipboard:"),
            clip.map(x => h('li', {}, x.name)),
        ))
    }

    function paste() {
        return apiCall('move_files', {
            uri_from: clip.map(x => x.uri),
            uri_to: here,
        }).then(res => {
            const bad = _.sumBy(res.errors, x => x ? 1 : 0)
            alertDialog(h(Fragment, {},
                t('good_bad', { bad, good: clip.length - bad }, "{good} moved, {bad} failed"),
                h('ul', {}, res.errors.map(((e: any, i: number) => {
                    e = xlate(e, HTTP_MESSAGES)
                    return e && h('li', {}, clip[i].name + ': ' + e)
                }))),
            ), bad ? 'warning' : 'info')
            cancel()
            reloadList()
        }, alertDialog)
    }
}


export function cut(files: DirList) {
    state.clip = files
    if (files.length)
        return toast(t('after_cut', "Your selection is now in the clipboard.\nGo to destination folder to paste."), 'info')
}