// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import _ from 'lodash'
import glob from 'fast-glob'
import { readFile, rm, writeFile } from 'fs/promises'
import { HTTP_BAD_REQUEST, HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR } from './const'
import { tryJson } from './misc'

const PREFIX = 'hfs-lang-'
const SUFFIX = '.json'

const apis: ApiHandlers = {

    list_langs() {
        return new SendListReadable({
            doAtStart: async list => {
                for await (let name of glob.stream(code2file('*'))) {
                    name = String(name)
                    const code = name.slice(PREFIX.length, -SUFFIX.length)
                    try {
                        const data = JSON.parse(await readFile(name, 'utf8'))
                        list.add({ code, ..._.omit(data, 'translate') })
                    }
                    catch {}
                }
                list.close()
            }
        })
    },

    async del_lang({ code }) {
        validateCode(code)
        try {
            await rm(code2file(code))
            return {}
        }
        catch (e: any) {
            return new ApiError(e.code || HTTP_SERVER_ERROR, e)
        }
    },

    async add_langs({ langs }) {
        for (let [code, content] of Object.entries(langs)) {
            if (code.endsWith(SUFFIX)) // filename, actually
                code = code.slice(PREFIX.length, -SUFFIX.length)
            validateCode(code)
            const fn = code2file(code)
            const s = content = String(content)
            if (!tryJson(s))
                return new ApiError(HTTP_NOT_ACCEPTABLE, "bad content for file " + fn)
            await writeFile(fn, s, 'utf8')
        }
        return {}
    }

}

export default apis

function code2file(code: string) {
    return PREFIX + code.toLowerCase() + SUFFIX
}

function validateCode(code: string) {
    if (!/^(\w\w)(-\w\w)*$/.test(code))
        throw new ApiError(HTTP_BAD_REQUEST, 'bad code/filename')
}