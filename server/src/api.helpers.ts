// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Account, allowClearTextLogin, saveSrpInfo, updateAccount } from './perm'
import { ApiError } from './apiMiddleware'

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
    if (allowClearTextLogin.get())
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
