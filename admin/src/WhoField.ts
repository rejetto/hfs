import { createElement as h, type ReactElement, useMemo } from 'react'
import { Box, Collapse, FormHelperText } from '@mui/material'
import { Group } from '@mui/icons-material'
import { type Field, type FieldProps, MultiSelectField, SelectField } from '@hfs/mui-grid-form'
import {
    isWhoObject, onlyTruthy, prefix, wantArray, type WhoObject, type WhoVfs, WHO_ADMIN, WHO_ANY_ACCOUNT, WHO_ANYONE,
    WHO_NO_ONE, xlate,
} from './misc'
import { useApiEx } from './api'
import { LinkBtn } from './mui'
import apiAccounts from '../../src/api.accounts'
import _ from 'lodash'

export function perm2word(perm: string) {
    return xlate(perm.split('_')[1], { read: 'download', archive: 'zip', list: 'access list' })
}

export type AccountsApi = ReturnType<typeof useAccountsApi>
export function useAccountsApi() {
    return useApiEx<typeof apiAccounts.get_accounts>('get_accounts', {}, {
        onResponse(_res, data) {
            if (!data) return
            data.list = _.sortBy(data.list, 'username')
        }
    })
}

export interface WhoFieldProps extends FieldProps<WhoVfs | undefined> {
    accountsApi?: AccountsApi,
    otherPerms?: any[],
    isChildren?: boolean,
    isDir: boolean
    contentText?: string
}
export function WhoField({ value, onChange, parent, inherit, accountsApi, helperText, otherPerms, byMasks,
        hideValues, isChildren, isDir, contentText="folder content", setApi, offerInheritance, ...rest }: WhoFieldProps): ReactElement {
    const defaultLabel = who2desc(byMasks ?? inherit)
        + prefix(' (', byMasks !== undefined ? "from masks" : parent !== undefined ? "as parent folder" : "default", ')')
    const objectMode = isWhoObject(value)
    const thisValue = objectMode ? value.this : value
    accountsApi ??= useAccountsApi() // it's important that the "accounts" prop is stable in the truthy sense
    const accounts = accountsApi?.data?.list

    const options = useMemo(() =>
        onlyTruthy([
            offerInheritance && { value: null, label: defaultLabel },
            { value: WHO_NO_ONE },
            { value: WHO_ANY_ACCOUNT },
            { value: WHO_ADMIN },
            { value: WHO_ANYONE },
            ...otherPerms || [],
            { value: [], label: "Select accounts" },
        ].map(x => x && !hideValues?.includes(x.value)
            && { label: who2desc(x.value), ...x })), // default label
        [inherit, parent, thisValue, ...wantArray(hideValues)])

    const timeout = 500
    const arrayMode = Array.isArray(thisValue)
    // a large sideband will convey union across the fields
    return h(Box, { sx: { borderRight: objectMode ? '8px solid #8884' : undefined, transition: `all ${timeout}ms` } },
        h(SelectField as typeof SelectField<typeof thisValue | null>, {
            ...rest,
            value: arrayMode ? [] : thisValue ?? null,
            onChange: changeThis,
            options,
        }),
        h(Collapse, { in: arrayMode, timeout },
            arrayMode && h(MultiSelectField as Field<string[]>, {
                label: accounts?.length ? "Accounts " + rest.label : "You didn't create any account yet",
                value: thisValue,
                onChange: changeThis,
                options: accounts?.map(a => ({ value: a.username, label: a.username, a })) || [],
                placeholder: "none",
                ...thisValue.length === 0 && { helperText: "Select some account", error: true },
                // show icon only for groups, to save space inside the field (not the list)
                renderOption: (x: any) => h('span', {}, x.a?.isGroup && h(Group), ' ', x.label),
            }) ),
        h(FormHelperText, {},
            helperText,
            !isChildren && isDir && h(LinkBtn, {
                sx: { display: 'block', mt: -.5 },
                onClick(event) {
                    onChange(objectMode ? thisValue : { this: thisValue, children: thisValue == null ? !inherit : undefined  } , { was: value, event })
                }
            }, objectMode ? "Set same permission for " : "Set different permission for ", contentText)
        ),
        !isChildren && h(Collapse, { in: objectMode, timeout },
            h(WhoField, {
                label: "Permission for " + contentText,
                parent, inherit, accountsApi, otherPerms, isDir,
                value: objectMode ? value?.children : undefined,
                isChildren: true,
                hideValues: [thisValue ?? inherit, thisValue],
                onChange(v, { event }) {
                    if (objectMode) // shut up ts
                        onChange(simplify({ ...value, children: v }), { was: value, event })
                }
            })
        ),
    )

    function changeThis(v: WhoVfs | null | undefined, { event }: { event: unknown }) {
        onChange(objectMode ? simplify({ ...value, this: v ?? undefined }) : v ?? undefined, { was: value, event })
    }

    function simplify(v: WhoObject) {
        return v.this === v.children ? v.this : v
    }
}

export function who2desc(who: any) {
    return who === false ? "No one"
        : who === true ? "Anyone"
            : who === WHO_ANY_ACCOUNT ? "Any logged-in account"
                : who === WHO_ADMIN ? "Any admin"
                    : Array.isArray(who) ? who.join(', ')
                        : typeof who === 'string' ? `As "can ${perm2word(who)}"`
                            : "*UNKNOWN*" + JSON.stringify(who)
}
