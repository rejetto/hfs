import {
    AvailablePlugin,
    enablePlugins,
    getAvailablePlugins,
    getPluginConfigFields,
    mapPlugins,
    parsePluginSource,
    Plugin, pluginsConfig,
    PATH as PLUGINS_PATH
} from './plugins'
import _ from 'lodash'
import assert from 'assert'
import { httpsString, httpsStream, objSameKeys, onOff, same } from './misc'
import { ApiError, ApiHandlers, sendList } from './apiMiddleware'
import events from './events'
import unzipper from 'unzipper'
import { createWriteStream } from 'fs'
import { access, mkdir } from 'fs/promises'

const DIST_ROOT = 'dist/'

const apis: ApiHandlers = {
    get_plugins({}, ctx) {
        const list = sendList([ ...mapPlugins(serialize), ...getAvailablePlugins() ])
        return list.events(ctx, {
            pluginInstalled: p => list.add(serialize(p)),
            'pluginStarted pluginStopped': p => {
                const { id, ...rest } = serialize(p)
                list.update({ id }, rest)
            },
            pluginUninstalled: id => list.remove({ id }),
        })

        function serialize(p: Readonly<Plugin> | AvailablePlugin) {
            return Object.assign('getData' in p ? p.getData() : p, { started: null }, _.pick(p, ['id','started']))
        }
    },

    async set_plugin({ id, enabled, config }) {
        assert(id, 'id')
        if (enabled !== undefined)
            enablePlugins.set( arr =>
                arr.includes(id) === enabled ? arr
                    : enabled ? [...arr, id]
                        : arr.filter((x: string) => x !== id)
            )
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
        const repo2id = Object.fromEntries(getAvailablePlugins().map(x => [x.repo, x.id]))
        Object.assign(repo2id, Object.fromEntries(mapPlugins(x => [x.getData().repo, x.id]))) // started ones
        apiGithub('search/repositories?q=topic:hfs-plugin+' + encodeURI(text)).then(res => {
            const jobs = []
            for (const it of res.items) {
                const repo = it.full_name
                const job = httpsString(`https://raw.githubusercontent.com/${repo}/master/${DIST_ROOT}plugin.js`).then(res => {
                    if (!res.ok)
                        throw res.statusCode
                    const pl = parsePluginSource(repo, res.body) // use 'repo' as 'id' client-side
                    if (!pl.apiRequired || pl.badApi) return
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
                })
                jobs.push(job)
            }
            Promise.allSettled(jobs).then(() => list.end())
        })
        return list.return
    },

    async download_plugin({ id }) {
        if (downloading[id])
            return new ApiError(409, "already downloading")
        downloadPlugin(id).then()
        return {}
    },

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

async function downloadPlugin(repo: string) {
    downloadProgress(repo, true)
    const rec = await apiGithub('repos/'+repo)
    const url = `https://github.com/${repo}/archive/${rec.default_branch}.zip`
    const res = await httpsStream(url)
    const repo2 = repo.split('/')[1] // second part, repo without the owner
    const repo2clash = getAvailablePlugins().find(x => x.id === repo2) || mapPlugins(x => x.id === repo2).some(Boolean)
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
