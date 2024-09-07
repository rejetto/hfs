// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { apiCall } from './api'
import { DAY, Dict, HOUR, MINUTE, objSameKeys, typedEntries } from '../src/cross'
export * from './react'
export * from './dialogs'
export * from './md'
export * from '../src/srp'
export * from '../src/cross'
// code in this file is shared among frontends, but not backend

;(window as any)._ = _

// roughly 0.7 on m1 max
export const cpuSpeedIndex = (() => {
    let ms = performance.now()
    _.range(1E5).map(x => ++x)
    ms = performance.now() - ms
    return 1 / ms
})()


const HFS = getHFS()
Object.assign(HFS, {
    getPluginKey: () => getScriptAttr('plugin'),
    getPluginPublic: () => getScriptAttr('src')?.match(/^.*\//)?.[0],
    getPluginConfig: () => HFS.plugins[HFS.getPluginKey()] || {},
    loadScript: (uri: string) => loadScript(uri.includes('//') || uri.startsWith('/') ? uri : HFS.getPluginPublic() + uri),
    cpuSpeedIndex,
})

export const IMAGE_FILEMASK = '*.jpg|*.jpeg|*.gif|*.svg'

//@ts-ignore
if (import.meta.env.PROD) {
    const was = console.debug
    console.debug = (...args) => (window as any).DEV && was(...args)
}

function getScriptAttr(k: string) {
    return document.currentScript?.getAttribute(k)
        || console.error("this function must be called at the very top of your file")
}

export const urlParams = Object.fromEntries(new URLSearchParams(window.location.search).entries())

export function buildUrlQueryString(params: Dict) { // not using URLSearchParams.toString as it doesn't work on firefox50
    return '?' + Object.entries(params).map(pair => pair.map(encodeURIComponent).join('=') ).join('&')
}

export function domOn<K extends keyof WindowEventMap>(eventName: K, cb: (ev: WindowEventMap[K]) => void, { target=window }={}) {
    if (!target) return
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
    return (window as any).HFS ||= {}
}

export function getPrefixUrl() {
    return getHFS().prefixUrl || ''
}

export function makeSessionRefresher(state: any) {
    let timeout: any
    const initial = getHFS().session
    refreshSession(initial)
    return refreshSession

    function refreshSession(response: any) {
        if (!response) return
        const { exp } = response
        Object.assign(initial, response) // keep it updated, not necessary, just in case someone is looking at this instead of the state
        Object.assign(state, _.pick(response, ['username', 'adminUrl', 'canChangePassword', 'accountExp']))
        if (!response.username || !exp) return
        const delta = new Date(exp).getTime() - Date.now()
        const t = _.clamp(delta - 30_000, 4_000, 600_000)
        console.debug('session refresh in', Math.round(t / 1000))
        clearTimeout(timeout)
        timeout = setTimeout(() => apiCall('refresh_session').then(refreshSession), t)
    }
}

export function focusSelector(selector: string, root: HTMLElement | Document=document) {
    const res = root.querySelector(selector)
    if (res && res instanceof HTMLElement) {
        res.focus()
        return true
    }
}

export function loadScript(url: string, more={}) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script')
        el.type = 'text/javascript'
        el.src = url
        el.onload = resolve
        el.onerror = reject
        for (const [k,v] of Object.entries(more))
            el.setAttribute(k, String(v))
        document.head.appendChild(el)
    })
}

export function fallbackToBasicAuth() {
    // @ts-ignore this is a trick from polyfills.js
    return BigInt === Number
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
