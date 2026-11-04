// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import _ from 'lodash'
import glob from 'fast-glob'
import { readFile, rm, writeFile } from 'fs/promises'
import { HTTP_BAD_REQUEST, HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR } from './const'
import { apiAssertTypes, tryJson } from './misc'
import { code2file, file2code, normalizeLangCode } from './lang'
import EMBEDDED_TRANSLATIONS from './langs/embedded'
import ADMIN_TRANSLATIONS from './admin-langs/embedded'
import { invalidateAdminLang } from './adminLang'
import { SendListReadable } from './SendList'

const apis: ApiHandlers = {

    get_langs() {
        return new SendListReadable({
            doAtStart: async list => {
                for (const admin of [false, true]) {
                    for await (const name of glob.stream(code2file('*', admin))) {
                        const code = file2code(String(name), admin)
                        try {
                            const data = JSON.parse(await readFile(String(name), 'utf8'))
                            list.add({ ..._.omit(data, 'translate'), code, admin, embedded: false })
                        }
                        catch {}
                    }
                    for (const [code, data] of Object.entries(admin ? ADMIN_TRANSLATIONS : EMBEDDED_TRANSLATIONS))
                        list.add({ ..._.omit(data, 'translate'), code, admin, embedded: true })
                }
                list.close()
            }
        })
    },

    async del_lang({ code, admin=false }) {
        apiAssertTypes({ string: { code }, boolean: { admin } })
        validateCode(code)
        try {
            await rm(code2file(code, admin))
            if (admin) invalidateAdminLang(code.toLowerCase())
            return {}
        }
        catch (e: any) {
            return new ApiError(HTTP_SERVER_ERROR, e)
        }
    },

    async add_langs({ langs }) {
        apiAssertTypes({ object: { langs } })
        for (let [code, content] of Object.entries(langs)) {
            const admin = code.startsWith('hfs-admin-lang-')
            code = file2code(code, admin)
            validateCode(code)
            const fn = code2file(code, admin)
            const s = String(content)
            const o = tryJson(s)
            if (!o?.translate)
                return new ApiError(HTTP_NOT_ACCEPTABLE, "bad content for file " + fn)
            await writeFile(fn, s, 'utf8')
            if (admin) invalidateAdminLang(code.toLowerCase())
        }
        return {}
    }

}

export default apis

function validateCode(code: string) {
    if (normalizeLangCode(code) !== code.toLowerCase())
        throw new ApiError(HTTP_BAD_REQUEST, 'bad code/filename')
}
