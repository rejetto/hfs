// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { changePasswordHelper, changeSrpHelper } from './api.helpers'
import { ApiError, ApiHandlers } from './apiMiddleware'
import {
    accountCanLogin,
    accountHasPassword,
    addAccount,
    delAccount,
    getAccount,
    getAccounts,
    getFromAccount,
    setAccount
} from './perm'
import _ from 'lodash'
import { getConfig } from './config'

const apis: ApiHandlers = {

    get_usernames() {
        return { list: Object.keys(getAccounts()) }
    },

    get_accounts() {
        return {
            list: Object.values(getAccounts()).map(ac => ({
                ..._.pick(ac, ['username','ignore_limits','redirects','belongs','admin']),
                hasPassword: accountHasPassword(ac),
                adminActualAccess: accountCanLogin(ac) && getFromAccount(ac, a => a.admin),
            }))
        }
    },

    set_account({ username, changes }) {
        const { admin } = changes
        if (admin === null)
            changes.admin = undefined
        else if (typeof admin !== 'boolean')
            return new ApiError(400, "invalid admin")
        if (getConfig('admin_login') && admin === false && !anyOtherAccessibleAccountWithAdmin())
            return new ApiError(403, "you can't disable admin because this is the last account with such permission")
        return setAccount(username, changes) ? {} : new ApiError(400)

        function anyOtherAccessibleAccountWithAdmin() {
            return _.some(getAccounts(), a => accountCanLogin(a)
                // with undefined we invite search to continue to its groups, because disabling admin on an account will still leave its inheritance on
                && Boolean(getFromAccount(a, a => a.username === username ? undefined : a.admin)))
        }
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
