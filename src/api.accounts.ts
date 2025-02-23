// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import {
    Account, accountCanLoginAdmin, accountHasPassword, accountsConfig, addAccount, delAccount, getAccount,
    changeSrpHelper, updateAccount, accountCanLogin
} from './perm'
import _ from 'lodash'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_NOT_FOUND } from './const'
import { getCurrentUsername, invalidateSessionBefore } from './auth'
import { apiAssertTypes, onlyTruthy, with_ } from './misc'

function prepareAccount(ac: Account | undefined) {
    return ac && {
        ..._.omit(ac, ['password','hashed_password','srp']),
        username: ac.username, // omit won't copy it because it's a hidden prop
        hasPassword: accountHasPassword(ac),
        isGroup: ac.plugin?.isGroup ?? !accountHasPassword(ac),
        adminActualAccess: accountCanLoginAdmin(ac),
        canLogin: accountHasPassword(ac) ? accountCanLogin(ac) : undefined,
        invalidated: invalidateSessionBefore.get(ac.username),
        directMembers: Object.values(accountsConfig.get()).filter(a => a.belongs?.includes(ac.username)).map(x => x.username),
        members: with_(Object.values(accountsConfig.get()), accounts => {
            const ret = []
            let news = [ac.username]
            while (news.length) {
                news = accounts.filter(a => a.belongs?.some(x => news.includes(x))).map(x => x.username)
                ret.push(...news)
            }
            return _.uniq(ret).sort()
        })
    }
}

export default  {

    get_usernames() {
        return { list: Object.keys(accountsConfig.get()) }
    },

    get_account({ username }, ctx) {
        return prepareAccount(getAccount(username || getCurrentUsername(ctx)))
            || new ApiError(HTTP_NOT_FOUND)
    },

    get_accounts() {
        return { list: onlyTruthy(Object.values(accountsConfig.get()).map(prepareAccount)) }
    },

    get_admins() {
        return { list: _.filter(accountsConfig.get(), accountCanLoginAdmin).map(ac => ac.username) }
    },

    async set_account({ username, changes }, ctx) {
        apiAssertTypes({ string: { username } })
        const acc = getAccount(username)
        if (!acc)
            return new ApiError(HTTP_BAD_REQUEST)
        await updateAccount(acc, changes)
        if (changes.username && ctx.session?.username === username)
            ctx.session!.username = changes.username
        return _.pick(acc, 'username')
    },

    async add_account({ overwrite, username, ...rest }) {
        apiAssertTypes({ string: { username } })
        const existing = getAccount(username)
        if (existing) {
            if (!overwrite) return new ApiError(HTTP_CONFLICT)
            await updateAccount(existing, rest)
            return _.pick(existing, 'username')
        }
        const acc = await addAccount(username, rest)
        return acc ? _.pick(acc, 'username') : new ApiError(HTTP_BAD_REQUEST) // return username because it is normalized
    },

    del_account({ username }) {
        apiAssertTypes({ string: { username } })
        return delAccount(username) ? {} : new ApiError(HTTP_BAD_REQUEST)
    },

    invalidate_sessions({ username }) {
        apiAssertTypes({ string: { username } })
        invalidateSessionBefore.set(username, Date.now())
        return {}
    },

    async change_srp({ username, salt, verifier }) {
        apiAssertTypes({ string: { username, salt, verifier } })
        const a = getAccount(username)
        return a ? changeSrpHelper(a, salt, verifier)
            : new ApiError(HTTP_NOT_FOUND)
    }

} satisfies ApiHandlers