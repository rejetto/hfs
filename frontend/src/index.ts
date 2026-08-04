// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@hfs/shared/min-crypto-polyfill'
import '@hfs/shared/polyfills'
import { getHFS } from '@hfs/shared'
import App from './App'

if (getHFS().bare) // a theme is taking over the look, so we skip the download too
    start()
else
    import('./defaultCss').then(start) // render only once styled, or we'd flash unstyled content

function start() {
    createRoot(document.getElementById('root')!)
        .render( h(StrictMode, {}, h(App)) )
}
