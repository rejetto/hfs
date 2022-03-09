// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Account, saveSrpInfo, updateAccount } from './perm'
import { ApiError } from './apiMiddleware'
import { CFG_ALLOW_CLEAR_TEXT_LOGIN, getConfig } from './config'

export async function changePasswordHelper(account: Account | undefined, newPassword: string) {
    if (!newPassword) // clear text version
        return Error('missing parameters')
    if (!account)
        return new ApiError(401)
    await updateAccount(account, account => {
        account.password = newPassword
    })
    return {}
}

export async function changeSrpHelper(account: Account | undefined, salt: string, verifier: string) {
    if (getConfig(CFG_ALLOW_CLEAR_TEXT_LOGIN))
        return new ApiError(406)
    if (!salt || !verifier)
        return Error('missing parameters')
    if (!account)
        return new ApiError(401)
    await updateAccount(account, account => {
        saveSrpInfo(account, salt, verifier)
        delete account.hashed_password // remove leftovers
    })
    return {}
}
