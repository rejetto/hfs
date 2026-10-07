// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import React, { createElement as h } from 'react'
import { Btn, iconBtn, Spinner } from './components'
import { newDialog, toast } from './dialog'
import { Icon, IconProps } from './icons'
import { Dict, domOn, getHFS, getOrSet, Html, HTTP_MESSAGES, urlParams, useBatch } from '@hfs/shared'
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
import { fileShow, Video, Audio, getShowComponent } from './show'
import { ANY_LANGUAGE } from '../../src/i18n'
import { debounceAsync } from '../../src/debounceAsync'
export * from '@hfs/shared'
import { hfsEvent, onPluginEvent } from '@hfs/shared/plugins'
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
    return openWorking()
}

export function workingWith(Content: React.FunctionComponent) {
    return openWorking(Content)
}

function openWorking(Content?: React.FunctionComponent) {
    if (isWorking)
        return ()=>{} // noop
    isWorking = true
    const { close } = newDialog({
        closable: false,
        noFrame: !Content,
        Content: Content || Spinner,
        reserveClosing: true,
        className: 'working' + (Content ? ' working-content' : ''),
        onClose(){
            isWorking = false
        }
    })
    return () => {
        isWorking = false
        close()
    }
}

export { hfsEvent, onHfsEvent } from '@hfs/shared/plugins'

export function formatTimestamp(x: number | string | Date, options?: Intl.DateTimeFormatOptions) {
    const cached = getOrSet(formatTimestamp as any, 'langs', () => {
        const ret = getLangs()
        const def = urlParams.lang || navigator.language
        return !ret.length || def.startsWith(ret[0]) ? def : ret // eg: if i'm ar-EG, and first translation is ar, keep ar-EG
    })
    return !x ? '' : (x instanceof Date ? x : new Date(x)).toLocaleString(cached, options)
}

import * as thisModule from './misc'
Object.assign(getHFS(), {
    h, React, state, t, _, dialogLib, apiCall, useApi, reloadList, logout, Icon, hIcon, iconBtn, useBatch, fileShow,
    toast, domOn, getNotifications, debounceAsync, useSnapState, DirEntry, Btn, i18n,
    fileShowComponents: { Video, Audio },
    isVideoComponent, markVideoComponent, isAudioComponent, markAudioComponent,
    isShowSupported: getShowComponent,
    misc: { ...cross, ...shared, ...thisModule },
    emit: hfsEvent,
    onEvent: (...args: Parameters<typeof onPluginEvent> extends [any, ...infer R] ? R : []) =>
        onPluginEvent(getHFS().getPluginKey(true) || '???', ...args),
    watchState(k: string, cb: (v: any) => void, callNow=false) {
        const up = k.split('upload.')[1]
        const thisState = up ? uploadState : state as any
        if (callNow)
            cb(thisState[up || k])
        return subscribeKey(thisState, up || k, cb, true)
    },
    customRestCall(name: string, ...rest: any[]) {
        return apiCall(cross.PLUGIN_CUSTOM_REST_PREFIX + name, ...rest)
    },
    html: (html: string) => h(Html, {}, html),
    elementToEntry(el: any) {
        if (!(el instanceof HTMLElement)) return
        const a = el.closest('li')?.querySelector('.link-wrapper a')
        if (!(a instanceof HTMLAnchorElement)) return
        try { return _.find(state.list, entry => decodeURI(entry.uri) === decodeURI(a.pathname)) }
        catch {}
    },
    customizeText(mods: Dict<string>, lang=ANY_LANGUAGE) {
        const o = i18n.state.translations
        if (lang === ANY_LANGUAGE || lang === cross.EMBEDDED_LANGUAGE) // these are missing at the start, but we need them if we want to customize content
            o[lang] ??= { translate: {} }
        Object.assign(o[lang]?.translate || {}, mods)
    }
})

markVideoComponent(Video)
markAudioComponent(Audio)
function isVideoComponent(Component: any) {
    return Boolean(Component?.hfs_show_video)
}
function markVideoComponent(Component: any) {
    Component.hfs_show_video = true
    return Component
}
function isAudioComponent(Component: any) {
    return Boolean(Component?.hfs_show_audio)
}
function markAudioComponent(Component: any) {
    Component.hfs_show_audio = true
    return Component
}

export function operationSuccessful() {
    return toast(t`Operation successful`, 'success')
}
