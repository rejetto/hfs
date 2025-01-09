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

// Utility function to validate parameters' types
function validateParams(params) {
    apiAssertTypes(params)
}

// Function to prepare account data by excluding sensitive information
function prepareAccount(ac: Account | undefined) {
    if (!ac) return undefined

    // Fetch and sort all members associated with the account
    const members = with_(Object.values(accountsConfig.get()), accounts => {
        const ret = []
        let news = [ac.username]
        while (news.length) {
            news = accounts.filter(a => a.belongs?.some(x => news.includes(x))).map(x => x.username)
            ret.push(...news)
        }
        return ret.sort()
    })

    return {
        ..._.omit(ac, ['password', 'hashed_password', 'srp']),
        username: ac.username, // Ensure username is included even though it's omitted by default
        hasPassword: accountHasPassword(ac),
        adminActualAccess: accountCanLoginAdmin(ac),
        canLogin: accountHasPassword(ac) ? accountCanLogin(ac) : undefined,
        invalidated: invalidateSessionBefore.get(ac.username),
        members
    }
}

export default  {

    // Return the list of all usernames
    get_usernames() {
        return { list: Object.keys(accountsConfig.get()) }
    },

    // Return account details for a specific username or the current username
    get_account({ username }, ctx) {
        validateParams({ string: { username } })
        const account = getAccount(username || getCurrentUsername(ctx))
        return prepareAccount(account) || new ApiError(HTTP_NOT_FOUND, 'Account not found')
    },

    // Return the list of all accounts
    get_accounts() {
        return { list: onlyTruthy(Object.values(accountsConfig.get()).map(prepareAccount)) }
    },

    // Return the list of all admin accounts
    get_admins() {
        const admins = _.filter(accountsConfig.get(), accountCanLoginAdmin)
        return { list: admins.map(ac => ac.username) }
    },

    // Set (update) account details, ensuring account exists
    async set_account({ username, changes }, ctx) {
        validateParams({ string: { username } })
        const acc = getAccount(username)
        if (!acc) return new ApiError(HTTP_NOT_FOUND, 'Account not found')

        await updateAccount(acc, changes)

        // If the username is changed and it's the current session user, update session
        if (changes.username && ctx.session?.username === username) {
            ctx.session!.username = changes.username
        }

        return _.pick(acc, 'username')
    },

    // Add a new account or overwrite an existing one if specified
    async add_account({ overwrite, username, ...rest }) {
        validateParams({ string: { username } })
        const existing = getAccount(username)

        if (existing) {
            if (!overwrite) {
                return new ApiError(HTTP_CONFLICT, `Account ${username} already exists`)
            }
            await updateAccount(existing, rest)
            return _.pick(existing, 'username')
        }

        try {
            const acc = await addAccount(username, rest)
            return acc ? _.pick(acc, 'username') : new ApiError(HTTP_BAD_REQUEST, 'Failed to add account')
        } catch (err) {
            return new ApiError(HTTP_BAD_REQUEST, 'Failed to add account')
        }
    },

    // Delete an account by username
    del_account({ username }) {
        validateParams({ string: { username } })
        const result = delAccount(username)
        return result ? {} : new ApiError(HTTP_BAD_REQUEST, 'Failed to delete account')
    },

    // Invalidate a session for a specific username
    invalidate_sessions({ username }) {
        validateParams({ string: { username } })
        invalidateSessionBefore.set(username, Date.now())
        return {}
    },

    // Change SRP (Secure Remote Password) parameters for a given account
    async change_srp({ username, salt, verifier }) {
        validateParams({ string: { username, salt, verifier } })
        const account = getAccount(username)
        return account ? changeSrpHelper(account, salt, verifier)
            : new ApiError(HTTP_NOT_FOUND, `Account ${username} not found`)
    }
} satisfies ApiHandlers
