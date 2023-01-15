// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

// simple wrapper
// @ts-ignore
import { pbkdf2, pbkdf2Verify } from "./pbkdf2"
import assert from 'assert'

export async function hashPassword(s: string) {
    return 'p2:' + await pbkdf2(s)
}

export async function verifyPassword(hashed: string, given: string) {
    const i = hashed.indexOf(':')
    assert(i>0, 'bad hashed')
    return await pbkdf2Verify(hashed.slice(i+1), given) // for the time being we totally ignore the "method" part
}
