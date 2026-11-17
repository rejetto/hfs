// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { isNativeError } from 'node:util/types'
import { HTTP_BAD_REQUEST, HTTP_MESSAGES, HTTP_SERVER_ERROR } from './cross-const'

// keep this class separate to avoid a circular import from searchPattern through apiMiddleware and misc
export class ApiError extends Error {
    constructor(public status:number, message?: unknown) {
        super(typeof message === 'string' ? message : message && message instanceof Error ? message.message : JSON.stringify(message))
    }

    static from(error: unknown) {
        if (error instanceof ApiError) return error
        if (typeof error === 'number') return new ApiError(error)
        if (typeof error === 'string') return new ApiError(HTTP_BAD_REQUEST, error) // strings are intentional client messages
        console.debug("API error", isNativeError(error) ? error.stack || error.message : error)
        return new ApiError(HTTP_SERVER_ERROR, HTTP_MESSAGES[HTTP_SERVER_ERROR])
    }
}
