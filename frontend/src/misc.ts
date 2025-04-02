// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import React, { createElement as h } from 'react'
import { Btn, iconBtn, Spinner } from './components'
import { newDialog, toast } from './dialog'
import { Icon, IconProps } from './icons'
import { Callback, Dict, domOn, getHFS, getOrSet, Html, HTTP_MESSAGES, urlParams, useBatch } from '@hfs/shared'
import * as cross from '../../src/cross'
import * as shared from '@hfs/shared'
import { apiCall, getNotifications, useApi } from '@hfs/shared/api'
import { DirEntry, state, useSnapState } from './state'
import * as dialogLib from './dialog'
import _ from 'lodash'
import { reloadList } from './useFetchList'
import { logout } from './login'
import { subscribeKey } from 'valtio/utils'
import { uploadState } from './uploadQueue'
import { fileShow, Video, Audio } from './show'
import { debounceAsync } from '../../src/debounceAsync'
export * from '@hfs/shared'
import i18n from './i18n'
const { t, getLangs } = i18n

export function err2msg(err: number | Error) {
    return typeof err === 'number' ? HTTP_MESSAGES[err]
        : (HTTP_MESSAGES[(err as any).code] || err.message || String(err))
}

export function hIcon(name: string, props?: Omit<IconProps, 'name'>) {
    return h(Icon, { name, ...props })
}

export function ErrorMsg({ err }: { err: any }) {
    return err ? h('div', { className:'error-msg' }, err?.message || _.isString(err) && err || `${t`Error`}:${err}`)
        : null
}

let isWorking = false // we want the 'working' thing to be singleton
export function working() {
    if (isWorking)
        return ()=>{} // noop
    isWorking = true
    const { close } = newDialog({
        closable: false,
        noFrame: true,
        Content: Spinner,
        reserveClosing: true,
        className: 'working',
        onClose(){
            isWorking = false
        }
    })
    return close
}

export function hfsEvent(name: string, params?:Dict) {
    const output: any[] = []
    const order: number[] = []
    const ev = new CustomEvent('hfs.'+name, { cancelable: true, detail: { params, output, order } })
    document.dispatchEvent(ev)
    const sortedOutput = order.length && _.sortBy(output.map((x, i) => [order[i] || 0, x]), '0').map(x => x[1])
    return Object.assign(sortedOutput || output, {
        isDefaultPrevented: () => ev.defaultPrevented,
    })
}

export function onHfsEvent(name: string, cb: (params:any, extra: { output: any[], setOrder: Callback<number>, preventDefault: Callback }, output: any[]) => any) {
    const key = 'hfs.' + name
    document.addEventListener(key, wrapper)
    return () => document.removeEventListener(key, wrapper)

    function wrapper(ev: Event) {
        const { params, output, order } = (ev as CustomEvent).detail
        let thisOrder
        const res = cb(params, {
            output,
            setOrder(x) { thisOrder = x },
            preventDefault: () => ev.preventDefault()
        }, output) // legacy pre-0.54, third parameter used by file-icons plugin
        if (res !== undefined && Array.isArray(output)) {
            output.push(res)
            if (thisOrder)
                order[output.length - 1] = thisOrder
        }
    }
}

export function formatTimestamp(x: number | string | Date, options?: Intl.DateTimeFormatOptions) {
    const cached = getOrSet(formatTimestamp as any, 'langs', () => {
        const ret = getLangs()
        const def = urlParams.lang || navigator.language
        return !ret.length || def.startsWith(ret[0]) ? def : ret // eg: if i'm ar-EG, and first translation is ar, keep ar-EG
    })
    return !x ? '' : (x instanceof Date ? x : new Date(x)).toLocaleString(cached, options)
}

Object.assign(getHFS(), {
    h, React, state, t, _, dialogLib, apiCall, useApi, reloadList, logout, Icon, hIcon, iconBtn, useBatch, fileShow,
    toast, domOn, getNotifications, debounceAsync, useSnapState, DirEntry, Btn,
    fileShowComponents: { Video, Audio },
    misc: { ...cross, ...shared },
    emit: hfsEvent,
    onEvent: onHfsEvent,
    watchState(k: string, cb: (v: any) => void, callNow=false) {
        const up = k.split('upload.')[1]
        const thisState = up ? uploadState : state as any
        if (callNow)
            cb(thisState[k])
        return subscribeKey(thisState, up || k, cb, true)
    },
    customRestCall(name: string, ...rest: any[]) {
        return apiCall(cross.PLUGIN_CUSTOM_REST_PREFIX + name, ...rest)
    },
    html: (html: string) => h(Html, {}, html),
})

export function operationSuccessful() {
    return toast(t`Operation successful`, 'success')
}