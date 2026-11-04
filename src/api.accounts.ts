// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import {
    Account, accountCanLoginAdmin, accountHasLoginMethod, accountHasPassword, accounts, addAccount, delAccount, getAccount,
    updateAccount, accountCanLogin, accountCanChangePassword, normalizeUsername, invalidateAccountSessions
} from './perm'
import _ from 'lodash'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_NOT_FOUND } from './const'
import { getCurrentUsername } from './auth'
import { getSessionStamp } from './sessionStamp'
import { apiAssertTypes, objFromKeys, onlyTruthy, with_ } from './misc'
import { pickProps } from './api.vfs'

function serializeAccount(ac: Account | undefined) {
    if (!ac) return
    const hasLogin = accountHasLoginMethod(ac)
    return {
        ..._.omit(ac, ['password','hashed_password','srp']),
        username: ac.username, // omit won't copy it because it's a hidden prop
        hasPassword: accountHasPassword(ac),
        isGroup: !hasLogin,
        adminActualAccess: accountCanLoginAdmin(ac),
        canLogin: hasLogin ? accountCanLogin(ac) : undefined,
        canChangePassword: accountCanChangePassword(ac),
        invalidated: Number(getSessionStamp(ac.username)?.split('.')[0]) || undefined,
        directMembers: Object.values(accounts.get()).filter(a => a.belongs?.includes(ac.username)).map(x => x.username),
        members: with_(Object.values(accounts.get()), accounts => {
            const ret: string[] = []
            // breadth-first traversal follows indirect memberships and excludes already collected accounts
            let news = [ac.username]
            while (news.length) {
                news = accounts.filter(a => !ret.includes(a.username) && a.belongs?.some(x => news.includes(x))).map(x => x.username)
                ret.push(...news)
            }
            return ret.sort()
        })
    }
}

const ALLOWED_KEYS: (keyof Account)[] = ['admin', 'allow_net', 'auto_login_net', 'belongs', 'days_to_live', 'disable_password_change',
    'disabled', 'expire', 'ignore_limits', 'notes', 'password', 'redirect', 'require_password_change', 'username']

export default  {

    get_usernames() {
        return { list: Object.keys(accounts.get()) }
    },

    get_account({ username }, ctx) {
        apiAssertTypes({ string_undefined: { username } })
        return serializeAccount(getAccount(username || getCurrentUsername(ctx)))
            || new ApiError(HTTP_NOT_FOUND)
    },

    get_accounts() {
        return { list: onlyTruthy(Object.values(accounts.get()).map(serializeAccount)) }
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
        if (ctx.session?.username === normalizeUsername(username)) { // preserve only the session making its own account change
            ctx.session!.username = acc.username
            ctx.session!.stamp = getSessionStamp(acc.username)
        }
        return _.pick(acc, 'username')
    },

    async add_account({ overwrite, username, ...rest }, ctx) {
        apiAssertTypes({ string: { username } })
        const existing = getAccount(username)
        rest = pickProps(rest, ALLOWED_KEYS)
        if (existing) {
            if (!overwrite) return new ApiError(HTTP_CONFLICT)
            await updateAccount(existing, rest)
            if (ctx.session?.username === existing.username)
                ctx.session.stamp = getSessionStamp(existing.username)
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
        invalidateAccountSessions(username)
        return {}
    },

} satisfies ApiHandlers
