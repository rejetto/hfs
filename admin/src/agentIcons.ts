import { createElement as h, Fragment, useState } from 'react'
import { Box } from '@mui/material'
import { Dict, shortenAgent } from '@hfs/shared'
import _ from 'lodash'

const UW = 'https://upload.wikimedia.org/wikipedia/commons/'
const CLIENT_ICONS = {
    Chrome: UW + 'e/e1/Google_Chrome_icon_%28February_2022%29.svg',
    Chromium: UW + 'f/fe/Chromium_Material_Icon.svg',
    Firefox: UW + 'a/a0/Firefox_logo%2C_2019.svg',
    Safari: UW + '../en/7/71/Safari_Liquid_Glass_icon.png',
    Edge: UW + '9/98/Microsoft_Edge_logo_%282019%29.svg',
    Opera: UW + '4/49/Opera_2015_icon.svg',
    Finder: UW + 'thumb/b/b9/Finder_Icon_macOS_Tahoe.png/250px-Finder_Icon_macOS_Tahoe.png',
    Cyberduck: UW + 'archive/4/48/20091115091336%21Cyberduck_icon.png',
    ForkLift: UW + '../en/9/96/ForkLift_3_File_Manager_and_File_Transfer_Client_Logo.png',
    Explorer: UW + '3/33/Microsoft_PowerToys-Logo_File_Explorer_Preview_02.svg',
    WinSCP: UW + '4/4f/WinSCP_6_Logo.png',
}
const OS_ICONS = {
    Android: UW + 'd/d7/Android_robot.svg',
    Linux: UW + '0/0a/Tux-shaded.svg',
    Windows: UW + '0/0a/Unofficial_Windows_logo_variant_-_2002%E2%80%932012_%28Multicolored%29.svg',
    macOS: UW + '7/74/Apple_logo_dark_grey.svg', // grey works for both themes
    iOS: UW + '7/74/Apple_logo_dark_grey.svg', // grey works for both themes
}
const OSS = {
    iOS: /iPhone OS|iPad/,
    macOS: /Mac OS|Darwin/,
    Windows: /Windows NT|^Microsoft-WebDAV|^WinSCP/,
    Android: /Android/,
    Linux: /Linux/,
}
const alreadyFailed: any = {}

export function agentIcons(agent: string | undefined) {
    if (!agent) return
    const short = shortenAgent(agent)
    const browserIcon = h(AgentIcon, { k: short, altText: true, map: CLIENT_ICONS })
    const os = _.findKey(OSS, re => re.test(agent))
    return h(Box, { sx: { fontSize: '110%' } }, browserIcon, ' ', os && osIcon(os as any))
}

export function osIcon(k: keyof typeof OS_ICONS) {
    return h(AgentIcon, { k, map: OS_ICONS })
}

function AgentIcon({ k, map, altText }: { k: string, map: Dict<string>, altText?: boolean }) {
    const src = map[k]
    const [err, setErr] = useState(alreadyFailed[k])
    return !src || err ? h(Fragment, {}, altText ? k : null) : h('img', {
        src,
        alt: k + " icon",
        title: k,
        style: { height: '1.2em', verticalAlign: 'bottom', marginRight: '.2em' },
        onError() { setErr(alreadyFailed[k] = true) }
    })
}
