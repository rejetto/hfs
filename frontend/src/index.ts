// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import '@hfs/shared/min-crypto-polyfill'
import '@hfs/shared/polyfills'
import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import defaultStyle from './index.scss?inline'
import { getHFS } from '@hfs/shared'
import App from './App'

if (!getHFS().disableDefaultStyle)
    document.head.append(Object.assign(document.createElement('style'), { textContent: defaultStyle }))

createRoot(document.getElementById('root')!)
    .render( h(StrictMode, {}, h(App)) )
