// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiHandlers } from './apiMiddleware'
import { file_list } from './api.file_list'
import * as api_auth from './api.auth'
import { defineConfig } from './config'

const customHeader = defineConfig('custom_header')

export const frontEndApis: ApiHandlers = {
    file_list,
    ...api_auth,

    config() {
        return Object.fromEntries([customHeader].map(x => [x.key(), x.get()]))
    }
}
