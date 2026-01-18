// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import {
    Account, accountCanLoginAdmin, accountHasPassword, accounts, addAccount, delAccount, getAccount,
    changeSrpHelper, updateAccount, accountCanLogin, accountCanChangePassword, normalizeUsername
} from './perm'
import _ from 'lodash'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_NOT_FOUND } from './const'
import { getCurrentUsername, invalidateSessionBefore } from './auth'
import { apiAssertTypes, objFromKeys, onlyTruthy, with_ } from './misc'
import { pickProps } from './api.vfs'

function prepareAccount(ac: Account | undefined) {
    return ac && {
        ..._.omit(ac, ['password','hashed_password','srp']),
        username: ac.username, // omit won't copy it because it's a hidden prop
        hasPassword: accountHasPassword(ac),
        isGroup: !ac.plugin?.auth && !accountHasPassword(ac),
        adminActualAccess: accountCanLoginAdmin(ac),
        canLogin: accountHasPassword(ac) ? accountCanLogin(ac) : undefined,
        canChangePassword: accountCanChangePassword(ac),
        invalidated: invalidateSessionBefore.get(ac.username),
        directMembers: Object.values(accounts.get()).filter(a => a.belongs?.includes(ac.username)).map(x => x.username),
        members: with_(Object.values(accounts.get()), accounts => {
            const ret: string[] = []
            let news = [ac.username]
            while (news.length) {
                news = accounts.filter(a => !ret.includes(a.username) && a.belongs?.some(x => news.includes(x))).map(x => x.username)
                ret.push(...news)
            }
            return _.uniq(ret).sort()
        })
    }
}

const ALLOWED_KEYS: (keyof Account)[] = ['admin', 'allow_net', 'belongs', 'days_to_live', 'disable_password_change',
    'disabled', 'expire', 'ignore_limits', 'notes', 'password', 'redirect', 'require_password_change', 'username']

export default  {

    get_usernames() {
        return { list: Object.keys(accounts.get()) }
    },

    get_account({ username }, ctx) {
        apiAssertTypes({ string: { username } })
        return prepareAccount(getAccount(username || getCurrentUsername(ctx)))
            || new ApiError(HTTP_NOT_FOUND)
    },

    get_accounts() {
        return { list: onlyTruthy(Object.values(accounts.get()).map(prepareAccount)) }
    },

    get_admins() {
        return { list: _.filter(accounts.get(), accountCanLoginAdmin).map(ac => ac.username) }
    },

    async set_account({ username, changes }, ctx) {
        apiAssertTypes({ string: { username } })
        const acc = getAccount(username)
        if (!acc)
            return new ApiError(HTTP_BAD_REQUEST)
        await updateAccount(acc, pickProps(changes, ALLOWED_KEYS))
        if (changes.username && ctx.session?.username === normalizeUsername(username)) // update session if necessary
            ctx.session!.username = normalizeUsername(changes.username)
        return _.pick(acc, 'username')
    },

    async add_account({ overwrite, username, ...rest }) {
        apiAssertTypes({ string: { username } })
        const existing = getAccount(username)
        rest = pickProps(rest, ALLOWED_KEYS)
        if (existing) {
            if (!overwrite) return new ApiError(HTTP_CONFLICT)
            await updateAccount(existing, rest)
            return _.pick(existing, 'username')
        }
        const acc = await addAccount(username, rest)
        return acc ? _.pick(acc, 'username') : new ApiError(HTTP_BAD_REQUEST) // return username because it is normalized
    },

    del_account({ username }) {
        apiAssertTypes({ string_array: { username } })
        if (Array.isArray(username)) {
            const errors = _.pickBy(objFromKeys(username, u => delAccount(u) ? undefined : HTTP_NOT_FOUND))
            return _.isEmpty(errors) ? {} : { errors }
        }
        return delAccount(username) ? {} : new ApiError(HTTP_NOT_FOUND)
    },

    invalidate_sessions({ username }) {
        apiAssertTypes({ string: { username } })
        invalidateSessionBefore.set(normalizeUsername(username), Date.now())
        return {}
    },

    async change_srp({ username, salt, verifier }) {
        apiAssertTypes({ string: { username, salt, verifier } })
        const a = getAccount(username)
        return a ? changeSrpHelper(a, salt, verifier)
            : new ApiError(HTTP_NOT_FOUND)
    }

} satisfies ApiHandlers