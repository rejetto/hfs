// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { changePasswordHelper, changeSrpHelper } from './api.helpers'
import { ApiError, ApiHandlers } from './apis'
import { addAccount, delAccount, getAccount, getAccounts, setAccount } from './perm'

const apis: ApiHandlers = {

    get_usernames() {
        return { list: Object.keys(getAccounts()) }
    },

    get_accounts() {
        return {
            list: Object.values(getAccounts()).map(ac => ({
                ...ac,
                username: ac.username, // it's hidden and won't be copied by the spread operator
                hasPassword: Boolean(ac.password || ac.hashed_password || ac.srp),
                password: undefined,
                hashed_password: undefined,
                srp: undefined,
            }))
        }
    },

    set_account({ username, changes }) {
        return setAccount(username, changes) ? {} : new ApiError(400)
    },

    add_account({ username, ...rest }) {
        if (getAccount(username))
            return new ApiError(403)
        if (!addAccount(username, rest))
            return new ApiError(400)
        return {}
    },

    del_account({ username }) {
        return delAccount(username) ? {} : new ApiError(400)
    },

    async change_password({ username, newPassword }) {
        return changePasswordHelper(getAccount(username), newPassword)
    },

    async change_srp({ username, salt, verifier }) {
        return changeSrpHelper(getAccount(username), salt, verifier)
    }

}

export default apis
