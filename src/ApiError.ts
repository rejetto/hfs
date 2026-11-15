// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

export class ApiError extends Error {
    constructor(public status:number, message?: unknown) {
        super(typeof message === 'string' ? message : message && message instanceof Error ? message.message : JSON.stringify(message))
    }
}
