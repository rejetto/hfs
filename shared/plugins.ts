import { createElement as h, Fragment, isValidElement, ReactNode, useEffect, useMemo, useState } from 'react'
import _ from 'lodash'
import { Callback, Dict, domOn, getHFS, Html, isPrimitive, loadScript, onlyTruthy, useStateMounted } from '.'

export function hfsEvent(name: string, params?:Dict) {
    const output: any[] = []
    const order: number[] = []
    const detail = { params, output, order }
    let ev = new CustomEvent('hfs.'+name, { detail, cancelable: true })
    document.dispatchEvent(ev)
    if (!ev.defaultPrevented) {
        ev = new CustomEvent('hfs.'+name+':after', { detail, cancelable: true })
        document.dispatchEvent(ev)
    }
    const sortedOutput = order.length && _.sortBy(output.map((x, i) => [order[i] || 0, x]), '0').map(x => x[1])
    return Object.assign(sortedOutput || output, {
        isDefaultPrevented: () => ev.defaultPrevented,
    })
}

type HfsEventCallback = (params:any, extra: { output: any[], setOrder: Callback<number>, preventDefault: Callback }) => any
export function onHfsEvent(pluginId: string, name: string, cb: HfsEventCallback, options?: { once?: boolean }) {
    if (!_.isFunction(cb)) return
    const key = 'hfs.' + name
    document.addEventListener(key, wrapper, options)
    return addPluginCleanup(pluginId, () => document.removeEventListener(key, wrapper))

    function wrapper(ev: Event) {
        const { params, output, order } = (ev as CustomEvent).detail
        let thisOrder
        try {
            const res = cb(params, {
                output,
                setOrder(x) { thisOrder = x },
                preventDefault: () => ev.preventDefault()
            })
            if (res === undefined) return
            if (Array.isArray(output)) {
                output.push(res instanceof Promise ? res.catch(printError) : res)
                if (thisOrder)
                    order[output.length - 1] = thisOrder
            }
        }
        catch(e) {
            printError(e)
        }

        function printError(e: any) {
            console.error(`plugin ${pluginId} on event ${name}: ${e}`)
        }
    }
}

export function onPluginEvent(pluginId: string, name: string, cb: HfsEventCallback, options?: { once?: boolean }) {
    return onHfsEvent(pluginId, name.endsWith(':') ? name + pluginId : name, cb, options)
}

type PluginLoadState = { started?: string, loaded: boolean }
const pluginLoadStates = new Map<string, PluginLoadState>()
export const PLUGIN_ASSET_TIMEOUT = 15_000

export function getPluginLoadStates() {
    return pluginLoadStates
}

export function clearPluginLoadState(pluginId: string) {
    pluginLoadStates.delete(pluginId)
}

export function setPluginLoadState(pluginId: string, state: PluginLoadState) {
    pluginLoadStates.set(pluginId, state)
}

const pluginCleanups = new Map<string, Set<() => unknown>>()
const PLUGIN_UI_CHANGED = 'hfs.pluginUiChanged'

export function addPluginCleanup(pluginId: string, cleanup: () => unknown) {
    const cleanups = pluginCleanups.get(pluginId) || new Set()
    pluginCleanups.set(pluginId, cleanups)
    cleanups.add(run)
    return run

    function run() {
        if (!cleanups.delete(run)) return
        if (!cleanups.size) pluginCleanups.delete(pluginId)
        return cleanup()
    }
}

export function hasPluginCleanup(pluginId: string) {
    return pluginCleanups.has(pluginId)
}

export async function runPluginCleanups(pluginId: string) {
    const cleanups = Array.from(pluginCleanups.get(pluginId) || [])
    const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)))
    for (const result of results)
        if (result.status === 'rejected') console.error(`plugin ${pluginId} cleanup:`, result.reason)
}

export function pluginUiChanged() {
    document.dispatchEvent(new Event(PLUGIN_UI_CHANGED))
}

export function usePluginUiRevision() {
    const [revision, setRevision] = useState(0)
    useEffect(() =>
        domOn(PLUGIN_UI_CHANGED as any, () => setRevision(x => x + 1), { target: document }),
        [])
    return revision
}

// @param render always gets a truthy, even with empty children will get empty array, unless the custom-code is requiring to cancel the whole entry
export function CustomCode({ name, children, render, customHtml=true, ...props }: {
    name: string,
    customHtml?: boolean,
    children?: ReactNode,
    render?: Callback<ReactNode, ReactNode>
    [k :string]: any,
}) {
    const pluginUiRevision = usePluginUiRevision()
    const raw = useMemo(() => hfsEvent(name, Object.assign(props, { def: children })), // not using 'default' as key, because user can have unexpected error destructuring object
        [name, children, pluginUiRevision, ...props ? Object.values(props) : []])
    const [out, setOut] = useStateMounted<null | ReactNode[]>([])
    useEffect(() => {
        let active = true
        if (raw.isDefaultPrevented() || raw.some(x => x === null)) // null means skip this
            return setOut(null)
        const worked: ReactNode[] = raw.map(toElement)
        raw.forEach((x, i) => {
            if (typeof x?.then === 'function') // then-able
                x.then((resolved: any) => {
                    if (!active) return // old promises must not overwrite content for newer props
                    worked[i] = toElement(resolved, i)
                    setOut(onlyTruthy(worked))
                }, () => {})
        })
        const html = customHtml && getHFS().customHtml?.[name]
        if (html?.trim?.())
            worked.push(toElement(html, -1))
        setOut(onlyTruthy(worked))

        function toElement(x: unknown, key: number) {
            return isValidElement(x) ? h(Fragment, { key }, x) // wrap to avoid console warnings
                : x === 0 || x && isPrimitive(x) ? h(Html, { key }, String(x))
                    : _.isArray(x) ? h(Fragment, { key }, ...x)
                        : null
        }
        return () => { active = false }
    }, [raw, customHtml])
    render ??= _.identity
    return h(Fragment, {}, render(out && (out?.length || !children ? out : children)) )
}

export async function loadPluginScripts({ timeout=0 }={}) {
    const scripts: { id: string, group: number, js: string[], started?: string }[] = getHFS().loadScripts || []
    // dependency barriers separate batches; files within each plugin retain their declared order
    for (const batch of Object.values(_.groupBy(scripts, 'group')))
        await Promise.all(batch.map(async plugin => {
            let loaded = true
            for (const url of plugin.js) {
                try {
                    await loadScript(url, { plugin: plugin.id }, timeout)
                }
                catch (error) {
                    console.error(`plugin ${plugin.id} failed to load ${url}`, error)
                    loaded = false
                    break
                }
            }
            setPluginLoadState(plugin.id, { started: plugin.started, loaded })
        }))
}
