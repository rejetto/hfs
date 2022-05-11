import {
    AvailablePlugin,
    enablePlugins,
    getAvailablePlugins,
    getPluginConfigFields,
    mapPlugins,
    parsePluginSource,
    Plugin, pluginsConfig,
    PATH as PLUGINS_PATH, isPluginRunning, enablePlugin, getPluginInfo, rescan
} from './plugins'
import _ from 'lodash'
import assert from 'assert'
import { httpsString, httpsStream, objSameKeys, onOff, same, wait } from './misc'
import { ApiError, ApiHandlers, sendList } from './apiMiddleware'
import events from './events'
import unzipper from 'unzipper'
import { createWriteStream, mkdirSync } from 'fs'
import { rm } from 'fs/promises'

const DIST_ROOT = 'dist/'

const apis: ApiHandlers = {

    get_plugins({}, ctx) {
        const list = sendList([ ...mapPlugins(serialize), ...getAvailablePlugins() ])
        return list.events(ctx, {
            pluginInstalled: p => list.add(serialize(p)),
            'pluginStarted pluginStopped pluginUpdated': p => {
                const { id, ...rest } = serialize(p)
                list.update({ id }, rest)
            },
            pluginUninstalled: id => list.remove({ id }),
        })

        function serialize(p: Readonly<Plugin> | AvailablePlugin) {
            return Object.assign('getData' in p ? p.getData() : p, { started: null }, _.pick(p, ['id','started']))
        }
    },

    async get_plugin_updates() {
        const list = sendList()
        setTimeout(async () => {
            const repo2id = getRepo2id()
            for (const repo in repo2id) {
                const online = await readOnlinePlugin(repo)
                if (!online.apiRequired || online.badApi) continue
                const id = repo2id[repo]
                const disk = getPluginInfo(id)
                if (online.version! > disk.version)
                    list.add(online)
            }
            list.end()
        })
        return list.return
    },

    async set_plugin({ id, enabled, config }) {
        assert(id, 'id')
        if (enabled !== undefined)
            enablePlugin(id, enabled)
        if (config) {
            const fields = getPluginConfigFields(id)
            config = _.pickBy(config, (v, k) =>
                v !== null && !same(v, fields?.[k]?.defaultValue))
            if (_.isEmpty(config))
                config = undefined
            pluginsConfig.set(v => ({ ...v, [id]: config }))
        }
        return {}
    },

    async get_plugin({ id }) {
        return {
            enabled: enablePlugins.get().includes(id),
            config: {
                ...objSameKeys(getPluginConfigFields(id) ||{}, v => v?.defaultValue),
                ...pluginsConfig.get()[id]
            }
        }
    },

    search_online_plugins({ text }, ctx) {
        const list = sendList()
        const repo2id = getRepo2id()
        apiGithub('search/repositories?q=topic:hfs-plugin+' + encodeURI(text)).then(async res => {
            for (const it of res.items) {
                const repo = it.full_name
                const pl = await readOnlinePlugin(repo)
                if (!pl.apiRequired || pl.badApi) continue
                Object.assign(pl, { // inject some extra useful fields
                    downloading: downloading[repo],
                    installed: repo2id[repo]
                })
                list.add(pl)
                // watch for events about this plugin, until this request is closed
                ctx.req.on('close', onOff(events, {
                    pluginInstalled: p => {
                        if (p.repo === repo)
                            list.update({ id: repo }, { installed: true })
                    },
                    pluginUninstalled: id => {
                        if (repo === _.findKey(repo2id, x => x === id))
                            list.update({ id: repo }, { installed: false })
                    },
                    ['pluginDownload_'+repo](status) {
                        list.update({ id: repo }, { downloading: status ?? null })
                    }
                }) )
            }
            list.end()
        })
        return list.return
    },

    async download_plugin({ id }) {
        if (downloading[id])
            return new ApiError(409, "already downloading")
        await downloadPlugin(id)
        return {}
    },

    async update_plugin({ id }) {
        if (downloading[id])
            return new ApiError(409, "already downloading")
        await downloadPlugin(id, true)
        return {}
    },

    async uninstall_plugin({ id }) {
        while (isPluginRunning(id)) {
            enablePlugin(id, false)
            await wait(500)
        }
        await rm(PLUGINS_PATH + '/' + id,  { recursive: true, force: true })
        return {}
    }

}

type DownloadStatus = true | undefined
const downloading: Record<string, DownloadStatus> = {}

function downloadProgress(id: string, status: DownloadStatus) {
    if (status === undefined)
        delete downloading[id]
    else
        downloading[id] = status
    events.emit('pluginDownload_'+id, status)
}

async function downloadPlugin(repo: string, overwrite?: boolean) {
    downloadProgress(repo, true)
    const rec = await apiGithub('repos/'+repo)
    const url = `https://github.com/${repo}/archive/${rec.default_branch}.zip`
    const res = await httpsStream(url)
    const repo2 = repo.split('/')[1] // second part, repo without the owner
    const repo2clash = !overwrite
        && (getAvailablePlugins().find(x => x.id === repo2) || mapPlugins(x => x.id === repo2).some(Boolean))
    const pluginFolder = repo2clash ? repo.replace('/','-') : repo2 // longer form only if necessary
    const installFolder = PLUGINS_PATH + '/' + pluginFolder
    const GITHUB_ZIP_ROOT = repo2 + '-' + rec.default_branch // github puts everything within this folder
    const rootWithinZip = GITHUB_ZIP_ROOT + '/' + DIST_ROOT
    return new Promise(resolve =>
        res.pipe(unzipper.Parse())
            .on('entry', entry => {
                const { path, type } = entry
                if (!path.startsWith(rootWithinZip))
                    return entry.autodrain()
                const dest = installFolder + '/' + path.slice(rootWithinZip.length)
                if (type === 'File')
                    return entry.pipe(createWriteStream(dest))
                mkdirSync(dest, { recursive: true }) // easy way be sure to have the folder ready before proceeding
            })
            .on('close', () => {
                rescan() // workaround: for some reason, operations above are not triggering the rescan of the watched folder. Let's invoke it.
                resolve(undefined)
                downloadProgress(repo, undefined)
            }))
}

export default apis

function apiGithub(uri: string) {
    return httpsString('https://api.github.com/'+uri, {
        headers: {
            'User-Agent': 'HFS',
            Accept: 'application/vnd.github.v3+json',
        }
    }).then(async res => {
        if (!res.ok)
            throw res.statusCode
        return JSON.parse(res.body)
    })
}

function readOnlinePlugin(repo: string) {
    return httpsString(`https://raw.githubusercontent.com/${repo}/master/${DIST_ROOT}plugin.js`).then(res => {
        if (!res.ok)
            throw res.statusCode
        return parsePluginSource(repo, res.body) // use 'repo' as 'id' client-side
    })
}

function getRepo2id() {
    const ret = Object.fromEntries(getAvailablePlugins().map(x => [x.repo, x.id]))
    Object.assign(ret, Object.fromEntries(mapPlugins(x => [x.getData().repo, x.id]))) // started ones
    delete ret.undefined
    return ret
}
