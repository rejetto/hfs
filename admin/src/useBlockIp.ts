import { apiCall, useApi } from '@hfs/shared/api'
import { createElement as h, useCallback } from 'react'
import { BlockingRule } from '../../src/block'
import { toast } from './dialog'
import _ from 'lodash'
import { IconBtn, IconBtnProps } from './mui'
import { Block } from '@mui/icons-material'

export function useBlockIp() {
    const { data, reload } = useApi('get_config', { only: ['block'] })
    const block = useCallback((ip: string, more: Partial<BlockingRule>={}, showResult=true) =>
            apiCall('set_config', { values: { block: [...data.block, { ip, ...more }] } })
                .then(reload).then(() => showResult && toast("Blocked", 'success')),
        [data, reload])
    const isBlocked = useCallback((ip: string) => _.find(data?.block, { ip }), [data])
    return {
        iconBtn: (ip: string, comment: string, options: Partial<IconBtnProps>={}) => h(IconBtn, {
            icon: Block,
            title: "Block IP",
            confirm: "Block address " + ip,
            ...isBlocked(ip) && { disabled: true, title: "Blocked" },
            ...options,
            onClick: () => block(ip, { comment }),
        }),
    }
}
