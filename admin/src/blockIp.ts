import { createElement as h } from 'react'
import { t } from './i18n'
import { apiCall } from '@hfs/shared/api'
import { toast } from './dialog'
import { IconBtn, IconBtnProps } from './mui'
import { Block } from '@mui/icons-material'
import { useBatch } from '@hfs/shared'

export function BlockIpBtn({ ip, comment, ...rest }: { ip: string, comment: string } & Partial<IconBtnProps>) {
    const { data, refresh } = useBatch(isIpBlocked, ip, { delay: 100, expireAfter: 5_000 })
    return h(IconBtn, {
        icon: Block,
        title: t`Block IP`,
        confirm: t("Block address {ip}", { ip: ip }),
        ...data && { disabled: true, title: t`Blocked` },
        ...rest,
        async onClick() {
            await apiCall('add_block', { ip, merge: { comment } })
            refresh()
            toast(t`Blocked`, 'success')
        }
    })
}

async function isIpBlocked(ips: string[]) {
    return apiCall('is_ip_blocked', { ips }).then(x => x.blocked)
}
