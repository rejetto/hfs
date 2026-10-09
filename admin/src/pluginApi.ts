import React, { createElement as h, ComponentType } from 'react'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { BoolField, Form, MultiSelectField, NumberField, SelectField, StringField } from '@hfs/mui-grid-form'
import { allowPluginScripts, beginPluginScriptsUnload, forgetPluginScripts, getHFS, loadScript } from '@hfs/shared'
import {
    addPluginCleanup, clearPluginLoadState, hfsEvent, onPluginEvent, PLUGIN_ASSET_TIMEOUT, pluginUiChanged,
    qualifyPluginCustomRest, runPluginCleanups, setPluginLoadState,
} from '@hfs/shared/plugins'
import { apiCall } from './api'
import { state, useSnapState } from './state'
import { t } from './i18n'
import { Btn, Flex, IconBtn } from './mui'
import * as dialogLib from './dialog'
import { mainMenu, MenuEntry } from './MainMenu'
import { PLUGIN_CUSTOM_REST_PREFIX } from '../../src/cross'
import type { PageProps } from './App'

export interface PluginPage {
    id: string
    label: string
    icon?: ComponentType
    component: ComponentType<PageProps>
}

export interface AdminPluginAssets {
    id: string
    started?: string | null
    admin_js?: string[]
    admin_css?: string[]
    beforePlugin?: string
    afterPlugin?: string
    frontendConfig?: Record<string, unknown>
}

export async function unloadAdminPlugin(id: string, notify=true, preserveLoadState=false) {
    beginPluginScriptsUnload(id)
    await Promise.allSettled(hfsEvent('unload:' + id)) // emit before cleanup removes the plugin's event subscriptions
    await runPluginCleanups(id)
    document.querySelectorAll(`[plugin="${CSS.escape(id)}"]`).forEach(element => element.remove())
    forgetPluginScripts(id)
    if (!preserveLoadState) clearPluginLoadState(id)
    delete getHFS().plugins[id]
    if (notify) pluginUiChanged()
}

export async function loadAdminPlugin(plugin: AdminPluginAssets) {
    const { id, admin_js=[], admin_css=[] } = plugin
    if (!plugin.started) return unloadAdminPlugin(id)
    setPluginLoadState(id, { started: plugin.started, loaded: false })
    await unloadAdminPlugin(id, false, true)
    allowPluginScripts(id)
    getHFS().plugins[id] = plugin.frontendConfig || {}
    try {
        await Promise.all(admin_css.map(loadStyle))
        for (const url of admin_js)
            await loadScript(assetUrl(url), { plugin: id }, PLUGIN_ASSET_TIMEOUT)
    }
    catch(error) {
        await unloadAdminPlugin(id)
        throw error
    }
    setPluginLoadState(id, { started: plugin.started, loaded: true })
    pluginUiChanged()

    function loadStyle(url: string) {
        return new Promise<void>((resolve, reject) => {
            const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', type: 'text/css', href: assetUrl(url) })
            link.setAttribute('plugin', id)
            let settled = false
            const timer = setTimeout(() => finish(Error(`stylesheet load timeout: ${url}`)), PLUGIN_ASSET_TIMEOUT)
            link.onload = () => finish()
            link.onerror = error => finish(error)
            document.head.appendChild(link)

            function finish(error?: unknown) {
                if (settled) return
                settled = true
                clearTimeout(timer)
                if (error) {
                    link.remove()
                    reject(error)
                }
                else
                    resolve()
            }
        })
    }

    function assetUrl(url: string) {
        return url.includes('//') ? url : getHFS().prefixUrl + getHFS().PLUGINS_PUB_URI + id + '/' + url
    }
}

Object.assign(getHFS(), {
    h, React, state, useSnapState, t, apiCall, dialogLib,
    emit: hfsEvent,
    onEvent: (...args: Parameters<typeof onPluginEvent> extends [unknown, ...infer R] ? R : never) =>
        onPluginEvent(getHFS().getPluginKey(true) || '???', ...args),
    customRestCall(name: string, ...rest: Parameters<typeof apiCall> extends [unknown, ...infer R] ? R : never) {
        return apiCall(PLUGIN_CUSTOM_REST_PREFIX
            + (name.includes(':') ? name : qualifyPluginCustomRest(getHFS().getPluginKey(true), name)), ...rest)
    },
    admin: {
        components: {
            Alert, Box, Button, TextField, Typography, Flex, Btn, IconBtn,
            BoolField, Form, MultiSelectField, NumberField, SelectField, StringField,
        },
        addPage({ id, label, icon, component }: PluginPage) {
            const pluginId = getHFS().getPluginKey()
            if (!pluginId || !/^[\w-]+$/.test(id))
                throw Error("addPage requires a plugin script and a page id containing letters, digits, underscores or hyphens")
            const path: MenuEntry['path'] = `/plugins/${pluginId}/${id}`
            if (mainMenu.some(entry => entry.path === path))
                throw Error(`Page already registered: ${path}`)
            const entry: MenuEntry = { path, label, icon, comp: component }
            mainMenu.splice(mainMenu.length - 1, 0, entry)
            addPluginCleanup(pluginId, () => {
                const index = mainMenu.indexOf(entry)
                if (index >= 0) mainMenu.splice(index, 1)
                if (location.hash.startsWith('#' + path)) location.hash = '/plugins/installed'
            })
            return path
        },
    },
})
