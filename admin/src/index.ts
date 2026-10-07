// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.scss'
import '@hfs/shared/min-crypto-polyfill'
import App from './App'
import './pluginApi'
import { loadPluginScripts, PLUGIN_ASSET_TIMEOUT } from '@hfs/shared/plugins'

// plugins must register login hooks and pages before the first render
void loadPluginScripts({ timeout: PLUGIN_ASSET_TIMEOUT }).then(() => {
    createRoot(document.getElementById('root')!)
        .render(h(StrictMode, {}, h(App)))
})
