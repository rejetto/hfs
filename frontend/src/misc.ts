// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Spinner } from './components'
import { newDialog } from './dialog'
import { Icon } from './icons'
import { Dict } from '@hfs/shared'
export * from '@hfs/shared'

export function hIcon(name: string, props?:any) {
    return h(Icon, { name, ...props })
}

export function hError(err: Error | string | undefined) {
    return err && h('div', { className:'error-msg' }, typeof err === 'string' ? err : err.message)
}

export function isMobile() {
    return window.innerWidth < 800
}

let isWorking = false // we want the 'working' thing to be singleton
export function working() {
    if (isWorking)
        return ()=>{} // noop
    isWorking = true
    return newDialog({
        closable: false,
        noFrame: true,
        Content: Spinner,
        reserveClosing: true,
        className: 'working',
        onClose(){
            isWorking = false
        }
    })
}

export function hfsEvent(name: string, params?:Dict) {
    const output: any[] = []
    document.dispatchEvent(new CustomEvent('hfs.'+name, { detail:{ params, output } }))
    return output
}

const HFS: any = (window as any).HFS = {}

HFS.onEvent = (name: string, cb: (params:any, output:any) => any) => {
    document.addEventListener('hfs.' + name, ev => {
        const { params, output } = (ev as CustomEvent).detail
        const res = cb(params, output)
        if (res !== undefined && Array.isArray(output))
            output.push(res)
    })
}
