import { createElement as h, Fragment } from 'react'
import { Box, Link } from '@mui/material'
import { Error as ErrorIcon, PlayCircle, Warning } from '@mui/icons-material'
import { apiCall } from './api'
import { HFS_REPO, HTTP_FAILED_DEPENDENCY, NBSP, with_ } from './misc'
import { alertDialog, confirmDialog, toast } from './dialog'
import { Flex, hTooltip } from './mui'
import _ from 'lodash'

const HFS_GITHUB_ACCOUNT = HFS_REPO.replace(/\/.+/, `/`)
export const PLUGIN_ERRORS = { ENOTFOUND: "Cannot reach github.com", ECONNREFUSED: "Cannot reach github.com" }

export function renderPluginName({ row, value }: any) {
    const { repo } = row
    return h(Fragment, {},
        row.downgrade && errorIcon("This version is older than the one you installed. It is possible that the author found a problem with your version and decided to retire it.", true),
        errorIcon(row.error || row.badApi, !row.error),
        repo?.includes('//') ? h(Link, { href: repo, target: 'plugin' }, value)
            : with_(repo?.split('/'), arr => arr?.length !== 2 ? value
                : h(Fragment, {},
                    h(Link, { href: 'https://github.com/' + repo, target: 'plugin', onClick(ev) { ev.stopPropagation() } }, pluginName(arr[1])),
                    NBSP + 'by ', arr[0]
                ))
    )

    function errorIcon(msg: string, warning=false) {
        return msg && hTooltip(msg, msg, h(ErrorIcon, { fontSize: 'small', color: warning ? 'warning' : 'error', sx: { ml: -.5, mr: .5 } }))
    }
}

export async function startPlugin(id: string) {
    try {
        await apiCall('start_plugin', { id })
        toast("Plugin started", h(PlayCircle, { color: 'success' }))
        return true
    }
    catch(e: any) {
        alertDialog(`Plugin ${id} didn't start, with error: ${String(e?.message || e)}`, 'error')
    }
}

export async function installPluginFromResult(row: any) {
    if (!row.id.startsWith(HFS_GITHUB_ACCOUNT))
        if (!await confirmDialog(
            h(Flex, { vert: true, alignItems: 'center' },
                h(Warning, { color: 'warning', fontSize: 'large' }),
                "Proceed only if you trust this plugin",
                h(Box, { sx: { fontSize: '60%' } }, "A plugin has the same power of any other software"),
            ))) return
    if (row.missing && !await confirmDialog("This will also install: " + _.map(row.missing, 'repo').join(', '))) return
    const branch = row.branch || row.default_branch
    return installPlugin(row.id, branch).catch((e: any) => {
        if (e.code !== HTTP_FAILED_DEPENDENCY)
            return alertDialog(e)
        const msg = h(Fragment, {}, "This plugin has some dependencies unmet:",
            e.data.map((x: any) => h('li', { key: x.repo }, x.repo + ': ' + x.error)) )
        return alertDialog(msg, 'error')
    })
}

export function pluginName(name: string) {
    return name.replace(/hfs-/, '')
}

async function installPlugin(id: string, branch?: string): Promise<any> {
    try {
        const res = await apiCall('download_plugin', { id, branch, stop: true }, { timeout: false })
        if (await confirmDialog(`Plugin ${id} downloaded`, { trueText: "Start" }))
            await startPlugin(res.id)
    }
    catch(e:any) {
        let done = false
        if (e.code === HTTP_FAILED_DEPENDENCY) // try to install automatically
            for (const x of e.cause)
                if (x.error === 'missing') {
                    toast("Installing dependency: " + x.repo)
                    await installPlugin(x.repo)
                    done = true
                }
        if (done) // try again
            return installPlugin(id, branch)
        throw e
    }
}
