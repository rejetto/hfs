import { createElement as h, type ReactElement, useMemo } from 'react'
import { t, translateText } from './i18n'
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
    return t(xlate(perm.split('_')[1], { see: 'permission_see', read: 'permission_download', archive: 'permission_zip', list: 'permission_access_list' }))
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
        + prefix(' (', t(byMasks !== undefined ? "from masks" : parent !== undefined ? "as parent folder" : "default"), ')')
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
            { value: [], label: t`Select accounts` },
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
                label: accounts?.length ? t("Accounts {label}", { label: rest.label }) : t`You didn't create any account yet`,
                value: thisValue,
                onChange: changeThis,
                options: accounts?.map(a => ({ value: a.username, label: a.username, a })) || [],
                placeholder: t`none`,
                ...thisValue.length === 0 && { helperText: t`Select some account`, error: true },
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
            }, objectMode ? t`Set same permission for ` : t`Set different permission for `, translateText(contentText))
        ),
        !isChildren && h(Collapse, { in: objectMode, timeout },
            h(WhoField, {
                label: t("Permission for {contentText}", { contentText: contentText }),
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
    return who === false ? t`No one`
        : who === true ? t`Anyone`
            : who === WHO_ANY_ACCOUNT ? t`Any logged-in account`
                : who === WHO_ADMIN ? t`Any admin`
                    : Array.isArray(who) ? who.join(', ')
                        : typeof who === 'string' ? t('same_as_permission', { permission: perm2word(who) })
                            : t("unknown_value", { value: JSON.stringify(who) })
}
