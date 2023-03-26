// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import events from './events'
import { httpsString, httpsStream, unzip } from './misc'
import { getAvailablePlugins, mapPlugins, parsePluginSource, PATH as PLUGINS_PATH, rescan } from './plugins'
// @ts-ignore
import unzipper from 'unzip-stream'
import { ApiError } from './apiMiddleware'
import _ from 'lodash'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT } from './const'

const DIST_ROOT = 'dist/'

type DownloadStatus = true | undefined
const downloading: Record<string, DownloadStatus> = {}

function downloadProgress(id: string, status: DownloadStatus) {
    if (status === undefined)
        delete downloading[id]
    else
        downloading[id] = status
    events.emit('pluginDownload_'+id, status)
}

export async function downloadPlugin(repo: string, branch='', overwrite?: boolean) {
    if (downloading[repo])
        return new ApiError(HTTP_CONFLICT, "already downloading")
    downloadProgress(repo, true)
    const rec = await getRepoInfo(repo)
    if (!branch)
        branch = rec.default_branch
    const short = repo.split('/')[1] // second part, repo without the owner
    if (!short)
        return new ApiError(HTTP_BAD_REQUEST, "bad repo")
    const folder2repo = getFolder2repo()
    const folder = overwrite ? _.findKey(folder2repo, x => x===repo)! // use existing folder
        : short in folder2repo ? repo.replace('/','-') // longer form only if another plugin is using short form
            : short
    const installPath = PLUGINS_PATH + '/' + folder
    const GITHUB_ZIP_ROOT = short + '-' + branch // GitHub puts everything within this folder
    const rootWithinZip = GITHUB_ZIP_ROOT + '/' + DIST_ROOT
    const stream = await httpsStream(`https://github.com/${repo}/archive/refs/heads/${branch}.zip`)
    await unzip(stream, path =>
        path.startsWith(rootWithinZip) && installPath + '/' + path.slice(rootWithinZip.length) )
    downloadProgress(repo, undefined)
    await rescan() // workaround: for some reason, operations are not triggering the rescan of the watched folder. Let's invoke it.
    return folder
}

export function getRepoInfo(id: string) {
    return apiGithub('repos/'+id)
}

export async function readOnlinePlugin(repoInfo: { full_name: string, default_branch: string }, branch='') {
    const url = `https://raw.githubusercontent.com/${repoInfo.full_name}/${branch || repoInfo.default_branch}/${DIST_ROOT}plugin.js`
    const res = await httpsString(url)
    if (!res.ok)
        throw res.statusCode
    const pl = parsePluginSource(repoInfo.full_name, res.body) // use 'repo' as 'id' client-side
    pl.branch = branch || undefined
    return pl
}

export function getFolder2repo() {
    const ret = Object.fromEntries(getAvailablePlugins().map(x => [x.id, x.repo]))
    Object.assign(ret, Object.fromEntries(mapPlugins(x => [x.id, x.getData().repo])))
    return ret
}

async function apiGithub(uri: string) {
    const res = await httpsString('https://api.github.com/'+uri, {
        headers: {
            'User-Agent': 'HFS',
            Accept: 'application/vnd.github.v3+json',
        }
    })
    if (!res.ok)
        throw res.statusCode
    return JSON.parse(res.body)
}

export async function* searchPlugins(text='') {
    const res = await apiGithub('search/repositories?q=topic:hfs-plugin+' + encodeURI(text))
    for (const it of res.items) {
        const repo = it.full_name
        let pl = await readOnlinePlugin(it)
        if (!pl.apiRequired) continue // mandatory field
        if (pl.badApi) { // we try other branches (starting with 'api')
            const res = await apiGithub('repos/' + it.full_name + '/branches')
            const branches: string[] = res.map((x: any) => x?.name)
                .filter((x: any) => typeof x === 'string' && x.startsWith('api'))
                .sort().reverse()
            for (const branch of branches) {
                pl = await readOnlinePlugin(it, branch)
                if (!pl.apiRequired)
                    pl.badApi = '-'
                if (!pl.badApi)
                    break
            }
        }
        if (pl.badApi)
            continue
        Object.assign(pl, { // inject some extra useful fields
            downloading: downloading[repo],
            license: it.license?.spdx_id,
        }, _.pick(it, ['pushed_at', 'stargazers_count']))
        yield pl
    }
}
