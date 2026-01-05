// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { BrowserRouter, Route, Routes, useNavigate } from './router'
import { createElement as h, Fragment } from 'react'
import { BrowseFiles } from "./BrowseFiles"
import { alertDialog, Dialogs } from './dialog'
import useTheme from "./useTheme"
import { state, useSnapState } from './state'
import { acceptDropFiles } from './upload'
import { enqueueUpload, getFilePath, uploadState } from './uploadQueue'
import i18n from './i18n'
const { t } = i18n
import { proxy, ref, useSnapshot } from "valtio"
import { Spinner } from "./components"
import { enforceStarting, getHFS, getPrefixUrl, loadScript } from '@hfs/shared'
import { Toasts } from './toasts'

const { i18nWrapperProps } = i18n

function App() {
    useTheme()
    const { ready } = useSnapshot(pageState) // wait for all plugins to be loaded
    const { messageOnly } = useSnapState()
    if (messageOnly)
        return h('h1', { style: { textAlign: 'center'} }, messageOnly)
    if (!ready)
        return h(Spinner, { style: { margin: 'auto' } })
    installScript() // do this only after react has started working
    return h('div', {
        ...i18nWrapperProps(),
        ...acceptDropFiles((files, to) => {
            if (uploadState.uploadDialogIsOpen) // in this case the upload is not started until confirmed
                uploadState.adding.push(...files.map(f => ({ file: ref(f), path: getFilePath(f), to })))
            else
                state.props?.can_upload ? enqueueUpload(files.map(file => ({ file, path: getFilePath(file) })), location.pathname + to)
                    : alertDialog(t("Upload not available"), 'warning')
        })
    },
        h(BrowserRouter, {},
            h(NavigationExtractor, {},
                h(Toasts),
                h(Dialogs, {},
                    h(Routes, {},
                        h(Route, { path: '*', element: h(BrowseFiles) })
                    ),
                ),
            ),
        )
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
    el.id = 'customHtmlScript'
    document.head.appendChild(el)
}

function NavigationExtractor(props: any) {
    const go = useNavigate() // expose navigate function for programmatic usage
    getHFS().navigate = (uri: string) => go(getPrefixUrl() + enforceStarting('/', uri))
    return h(Fragment, props)
}

export default App;

const pageState = proxy({ ready: document.readyState === 'complete' })
document.addEventListener('readystatechange', () => {
    pageState.ready = document.readyState === 'complete'
})

// load plugins' now, as vite-legacy delayed app's loading
;(async () => { // without this wrapper I see a longer delay
    for (const [plugin, files] of Object.entries(getHFS().loadScripts))
        if (Array.isArray(files)) for (const f of files)
            await loadScript(f, { plugin })
})()
