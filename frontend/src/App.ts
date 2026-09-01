// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useLocation } from 'wouter'
import { createElement as h } from 'react'
import { BrowseFiles } from "./BrowseFiles"
import { alertDialog, Dialogs } from './dialog'
import useTheme from "./useTheme"
import { state, useSnapState } from './state'
import { acceptDropFiles } from './upload'
import { enqueueUpload, uploadState } from './uploadQueue'
import { proxy, ref, useSnapshot } from "valtio"
import _ from 'lodash'
import { CustomCode, Spinner } from "./components"
import { useAuthorized } from './login'
import { enforceStarting, getHFS, getPrefixUrl, loadScript } from '@hfs/shared'
import { Toasts } from './toasts'
import i18n from './i18n'
const { t } = i18n

const { i18nWrapperProps } = i18n

export default function App() {
    useTheme()
    i18n.useI18N()
    const go = useLocation()[1] // expose navigate function for programmatic usage
    getHFS().navigate = (uri: string) => go(getPrefixUrl() + enforceStarting('/', uri))

    const auth = useAuthorized()
    const { ready } = useSnapshot(pageState) // wait for all plugins to be loaded
    const { messageOnly } = useSnapState()
    if (messageOnly)
        return h('h1', { style: { textAlign: 'center'} }, messageOnly)
    if (!ready)
        return h(Spinner, { style: { margin: 'auto' } })
    installScript() // do this only after React has started working
    return h('div', {
        ...i18nWrapperProps(),
        ...acceptDropFiles(() => {
            if (uploadState.uploadDialogIsOpen) // in this case the upload is not started until confirmed
                return files => uploadState.adding.push(...files.map(x => ({ ...x, file: ref(x.file) })))
            const { can_upload, accept='' } = state.props || {}
            const destination = location.pathname
            return can_upload ? files => enqueueUpload(files, destination, accept)
                : () => alertDialog(t("Upload not available"), 'warning')
        })
    },
        h(Toasts),
        h(Dialogs, {},
            auth ? h(BrowseFiles)
                : h(CustomCode, { name: 'unauthorized' }, h('h1', { className: 'unauthorized' }, t`Unauthorized`) )
        ),
    )
}

let scriptAdded = false
function installScript() {
    if (scriptAdded) return // only once
    scriptAdded = true
    const s = getHFS().customHtml?.script // we don't need frontend-event-generated code, i guess
    if (!s) return
    const el = document.createElement('script')
    el.type = 'text/javascript'
    el.text = s
    el.setAttribute('plugin', el.id = '?customHtmlScript')
    document.head.appendChild(el)
}

export function navigate(uri: string) {
    return getHFS().navigate(uri)
}

const pageState = proxy({ ready: document.readyState === 'complete' })
document.addEventListener('readystatechange', () => {
    pageState.ready = document.readyState === 'complete'
})

// load plugins' now, as vite-legacy delayed app's loading
;(async () => { // without this wrapper I see a longer delay
    const loadScripts = getHFS().loadScripts
    for (const batch of Object.values(_.groupBy(loadScripts, 'group')))
        await Promise.all(batch.map(async plugin => {
            for (const url of plugin.js)
                await loadScript(url, { plugin: plugin.id })
        }))
})()
