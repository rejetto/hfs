// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { apiCall } from './api'
import { DAY, HOUR, MINUTE, objSameKeys, typedEntries } from '../src/cross'
export * from './react'
export * from './dialogs'
export * from './md'
export * from '../src/srp'
export * from '../src/cross'

// code in this file is shared among frontends, but not backend

(window as any)._ = _

const HFS = getHFS()
Object.assign(HFS, {
    getPluginKey: () => getScriptAttr('plugin'),
    getPluginPublic: () => getScriptAttr('src')?.match(/^.*\//)?.[0],
    getPluginConfig: () => HFS.plugins[HFS.getPluginKey()] || {},
})

function getScriptAttr(k: string) {
    return document.currentScript?.getAttribute(k)
        || console.error("this function must be called at the very top of your file")
}

export const urlParams = Object.fromEntries(new URLSearchParams(window.location.search).entries())

export function domOn<K extends keyof WindowEventMap>(eventName: K, cb: (ev: WindowEventMap[K]) => void, { target=window }={}) {
    target.addEventListener(eventName, cb)
    return () => target.removeEventListener(eventName, cb)
}

export function restartAnimation(e: HTMLElement | null, animation: string) {
    if (!e) return
    e.style.animation = ''
    void e.offsetWidth
    e.style.animation = animation
}

export function selectFiles(cb: (list: FileList | null)=>void, { accept='', multiple=true, folder=false }={}) {
    const el = Object.assign(document.createElement('input'), {
        type: 'file',
        name: 'file',
        accept,
        multiple: multiple,
        webkitdirectory: folder,
    })
    el.addEventListener('change', () =>
        cb(el.files))
    el.click()
}

export function readFile(f: File | Blob): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', (event) => {
            if (!event.target || f.size && !event.target.result)
                return reject('cannot read')
            const {result} = event.target
            resolve(result?.toString())
        })
        reader.addEventListener('error', () => {
            reject(reader.error)
        })
        reader.readAsText(f)
    })
}

export function isMobile() {
    return window.innerWidth < 800
}

export function getHFS() {
    return (window as any).HFS
}

export function getPrefixUrl() {
    return getHFS().prefixUrl || ''
}

export function makeSessionRefresher(state: any) {
    return function sessionRefresher(response: any) {
        if (!response) return
        const { exp } = response
        Object.assign(state, _.pick(response, ['username', 'adminUrl', 'canChangePassword', 'accountExp']))
        if (!response.username || !exp) return
        const delta = new Date(exp).getTime() - Date.now()
        const t = _.clamp(delta - 30_000, 4_000, 600_000)
        console.debug('session refresh in', Math.round(t / 1000))
        setTimeout(() => apiCall('refresh_session').then(sessionRefresher), t)
    }
}

export function focusSelector(selector: string, root: HTMLElement | Document=document) {
    const res = root.querySelector(selector)
    if (res && res instanceof HTMLElement) {
        res.focus()
        return true
    }
}

export function disableConsoleDebug() {
    const was = console.debug
    console.debug = (...args) => (window as any).DEV && was(...args)
}

type DurationUnit = 'day' | 'hour' | 'minute' | 'second'
export function createDurationFormatter({ locale=undefined, unitDisplay='narrow', largest='day', smallest='second', maxTokens, skipZeroes }:
            { skipZeroes?: boolean, largest?: DurationUnit, smallest?: DurationUnit, locale?: string, unitDisplay?: 'long' | 'short' | 'narrow', maxTokens?: 1 | 2 | 3 }={}) {
    const multipliers: Record<DurationUnit, number> = { day: DAY, hour: HOUR, minute: MINUTE, second: 1000 }
    const fmt = objSameKeys(multipliers, (v,k) => Intl.NumberFormat(locale, { style: 'unit', unit: k, unitDisplay }).format)
    const fmtList = new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' })
    return (ms: number) => {
        const a = []
        let on = false
        for (const [unit, mul] of typedEntries(multipliers)) {
            if (unit === smallest && a.length)
                break
            if (unit === largest)
                on = true
            if (!on) continue
            const v = Math.floor(ms / mul)
            if (!v && skipZeroes) continue
            a.push( fmt[unit]?.(v) ?? String(v) )
            if (a.length === maxTokens) break
            ms %= mul
        }
        return fmtList.format(a)
    }
}

Element.prototype.replaceChildren ||= function(this:Element, addNodes) { // polyfill
    while (this.lastChild) this.removeChild(this.lastChild);
    if (addNodes !== undefined) this.append(addNodes);
}
