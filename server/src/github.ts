import events from './events'
import { httpsStream, httpsString } from './misc'
import { getAvailablePlugins, mapPlugins, parsePluginSource, PATH as PLUGINS_PATH, rescan } from './plugins'
// @ts-ignore
import unzipper from 'unzip-stream'
import { createWriteStream, mkdirSync } from 'fs'
import { ApiError } from './apiMiddleware'
import _ from 'lodash'

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
        return new ApiError(409, "already downloading")
    downloadProgress(repo, true)
    const rec = await getRepoInfo(repo)
    if (!branch)
        branch = rec.default_branch
    const url = `https://github.com/${repo}/archive/refs/heads/${branch}.zip`
    const res = await httpsStream(url)
    const short = repo.split('/')[1] // second part, repo without the owner
    const folder2repo = getFolder2repo()
    const folder = overwrite ? _.findKey(folder2repo, x => x===repo) // use existing folder
        : short in folder2repo ? repo.replace('/','-') // longer form only if another plugin is using short form
            : short
    const installPath = PLUGINS_PATH + '/' + folder
    const GITHUB_ZIP_ROOT = short + '-' + branch // GitHub puts everything within this folder
    const rootWithinZip = GITHUB_ZIP_ROOT + '/' + DIST_ROOT
    return new Promise(resolve =>
        res.pipe(unzipper.Parse())
            .on('entry', (entry: any) => {
                const { path, type } = entry
                if (!path.startsWith(rootWithinZip))
                    return entry.autodrain()
                const dest = installPath + '/' + path.slice(rootWithinZip.length)
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

export async function* searchPlugins(text: string) {
    const res = await apiGithub('search/repositories?q=topic:hfs-plugin+' + encodeURI(text))
    for (const it of res.items) {
        const repo = it.full_name
        let pl = await readOnlinePlugin(it)
        if (!pl.apiRequired) continue // mandatory field
        if (pl.badApi) { // we try other branches (starting with 'api')
            const branches: string[] = (await apiGithub('repos/' + it.full_name + '/branches'))
                .map((x: any) => x.name).filter((x: string) => x.startsWith('api')).sort()
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
