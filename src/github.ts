// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import events from './events'
import { DAY, httpString, httpStream, unzip, AsapStream, debounceAsync, asyncGeneratorToArray, wait } from './misc'
import {
    DISABLING_SUFFIX, findPluginByRepo, getAvailablePlugins, getPluginInfo, isPluginEnabled, mapPlugins,
    parsePluginSource, PATH as PLUGINS_PATH, Repo, startPlugin, stopPlugin, STORAGE_FOLDER
} from './plugins'
import { ApiError } from './apiMiddleware'
import _ from 'lodash'
import { DEV, HFS_REPO, HFS_REPO_BRANCH, HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FORBIDDEN, HTTP_NOT_ACCEPTABLE,
    HTTP_SERVER_ERROR } from './const'
import { rename, rm } from 'fs/promises'
import { join } from 'path'
import { readFileSync } from 'fs'

const DIST_ROOT = 'dist'

type DownloadStatus = true | undefined
const downloading: Record<string, DownloadStatus> = {}

function downloadProgress(id: string, status: DownloadStatus) {
    if (status === undefined)
        delete downloading[id]
    else
        downloading[id] = status
    events.emit('pluginDownload', { id, status })
}

// determine default branch, possibly without consuming api quota
async function getGithubDefaultBranch(repo: string) {
    const test = await httpString(`https://github.com/${repo}/archive/refs/heads/main.zip`, { method: 'HEAD' }).then(() => 1, () => 0)
    return test ? 'main' : (await getRepoInfo(repo))?.default_branch as string
}

export async function downloadPlugin(repo: Repo, { branch='', overwrite=false }={}) {
    if (typeof repo !== 'string')
        repo = repo.main
    if (downloading[repo])
        throw new ApiError(HTTP_CONFLICT, "already downloading")
    const projectInfo = await getProjectInfo()
    if (projectInfo?.plugins_blacklist?.includes(repo))
        throw new ApiError(HTTP_FORBIDDEN, "blacklisted")
    console.log('downloading plugin', repo)
    downloadProgress(repo, true)
    try {
        if (repo.includes('//')) { // custom repo
            const pl = findPluginByRepo(repo)
            if (!pl)
                throw new ApiError(HTTP_BAD_REQUEST, "bad repo")
            const customRepo = ((pl as any).getData?.() || pl).repo
            let url = customRepo?.zip
            if (!url)
                throw new ApiError(HTTP_SERVER_ERROR, "bad plugin")
            if (!url.includes('//'))
                url = customRepo.web + url
            return await go(url, pl?.id, customRepo.zipRoot ?? DIST_ROOT)
        }
        branch ||= await getGithubDefaultBranch(repo)
        const short = repo.split('/')[1] // second part, repo without the owner
        if (!short)
            throw new ApiError(HTTP_BAD_REQUEST, "bad repo")
        const folder = overwrite ? _.findKey(getFolder2repo(), x => x===repo)! // use existing folder
            : getFolder2repo().hasOwnProperty(short) ? repo.replace('/','-') // longer form only if another plugin is using short form, to avoid overwriting
                : short
        const GITHUB_ZIP_ROOT = short + '-' + branch // GitHub puts everything within this folder
        return await go(`https://github.com/${repo}/archive/refs/heads/${branch}.zip`, folder, GITHUB_ZIP_ROOT + '/' + DIST_ROOT)

        async function go(url: string, folder: string, zipRoot: string) {
            const installPath = PLUGINS_PATH + '/' + folder
            const tempInstallPath = installPath + '--' + DISABLING_SUFFIX
            const foldersToCopy = [ // from longer to shorter, so we first test the longer
                zipRoot + '-' + process.platform + '-' + process.arch,
                zipRoot + '-' + process.platform,
                zipRoot,
            ].map(x => x + '/')
            // github zip doesn't have content-length, so we cannot produce progress event
            const stream = await httpStream(url)
            await unzip(stream, async path => {
                const folder = foldersToCopy.find(x => path.startsWith(x))
                if (!folder || path.endsWith('/')) return false
                let dest = path.slice(folder.length)
                dest = join(tempInstallPath, dest)
                return rm(dest, { force: true }).then(() => dest, () => false)
            })
            // ready to replace
            const wasEnabled = isPluginEnabled(folder)
            if (wasEnabled)
                await stopPlugin(folder) // stop old
            let retry = 3
            while (retry--) { // move data, and consider late release of the resource, up to a few seconds
                const res = rename(join(installPath, STORAGE_FOLDER), join(tempInstallPath, STORAGE_FOLDER))
                if (await res.then(() => true, () => false)) break
                await wait(1000)
            }
            await rm(installPath, { recursive: true }) // delete old
            await rename(tempInstallPath, installPath) // final replace
                .catch(e => { throw e.code !== 'ENOENT' ? e : new ApiError(HTTP_NOT_ACCEPTABLE, "missing main file") })
            if (wasEnabled)
                void startPlugin(folder) // don't wait, in case it fails to start
            return folder
        }
    }
    finally {
        downloadProgress(repo, undefined)
    }
}

export function getRepoInfo(id: string) {
    return apiGithub('repos/'+id)
}

export function readGithubFile(uri: string) {
    return httpString('https://raw.githubusercontent.com/' + uri)
}

export async function readOnlinePlugin(repo: Repo, branch='') {
    if (typeof repo !== 'string') { // non-github plugin
        const folder = _.findKey(getFolder2repo(), x => x === repo)
        if (!folder) throw Error()
        const pl = getPluginInfo(folder)
        let { main } = pl.repo
        if (!main) throw Error("missing repo.main")
        if (!main.includes('//'))
            main = pl.repo.web + main
        return parsePluginSource(main, await httpString(main)) // use 'repo' as 'id' client-side
    }
    branch ||= await getGithubDefaultBranch(repo)
    const res = await readGithubFile(`${repo}/${branch}/${DIST_ROOT}/plugin.js`)
    const pl = parsePluginSource(repo, res) // use 'repo' as 'id' client-side
    pl.branch = branch
    return pl
}

export async function readOnlineCompatiblePlugin(repo: Repo, branch='') {
    const pl = await readOnlinePlugin(repo, branch)
    if (!pl?.apiRequired) return // mandatory field
    if (!pl.badApi) return pl
    // we try other branches (starting with 'api')
    const res = await apiGithub('repos/' + repo + '/branches')
    const branches: string[] = res.map((x: any) => x?.name)
        .filter((x: any) => typeof x === 'string' && x.startsWith('api'))
        .sort().reverse()
    for (const branch of branches) {
        const pl = await readOnlinePlugin(repo, branch)
        if (!pl) continue
        if (!pl.apiRequired)
            pl.badApi = '-'
        if (!pl.badApi)
            return pl
    }
}

export function getFolder2repo() {
    const ret = Object.fromEntries(getAvailablePlugins().map(x => [x.id, x.repo]))
    Object.assign(ret, Object.fromEntries(mapPlugins(x => [x.id, x.getData().repo])))
    return ret
}

async function apiGithub(uri: string) {
    return httpString('https://api.github.com/' + uri, {
        headers: {
            'User-Agent': 'HFS',
            Accept: 'application/vnd.github.v3+json',
        }
    }).then(JSON.parse, e => {
        // https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limiting
        throw e.message === '403' ? Error('github_quota')
            : e
    })
}

async function *apiGithubPaginated<T=any>(uri: string) {
    const PAGE_SIZE = 100
    let page = 1
    let n = 0
    try {
        while (1) {
            const res = await apiGithub(uri + `&page=${page++}&per_page=${PAGE_SIZE}`)
            for (const x of res.items)
                yield x as T
            const now = res.items.length
            n += now
            if (!now || n >= res.total_count) break
        }
    }
    catch(e: any) {
        if (e.message !== '422') // for some strange reason github api is returning this error if we search repos for a missing user, instead of empty set
            throw e
    }
}

export async function searchPlugins(text='', { skipRepos=[''] }={}) {
    const projectInfo = await getProjectInfo()
    const searches = [encodeURI(text), ...text.split(' ').filter(Boolean).slice(0, 2).map(x => 'user:' + encodeURI(x))] // first 2 words can be the author
    const list = await Promise.all(searches.map(x => asyncGeneratorToArray(apiGithubPaginated(`search/repositories?q=topic:hfs-plugin+${x}`))))
        .then(all => all.flat()) // make it a single array
    return new AsapStream(list.map(async it => { // using AsapStream we parallelize these promises and produce each result as it's ready
        const repo = it.full_name as string
        if (projectInfo?.plugins_blacklist?.includes(repo) || skipRepos.includes(repo)) return
        const pl = await readOnlineCompatiblePlugin(repo, it.default_branch).catch(() => undefined)
        if (!pl) return
        Object.assign(pl, { // inject some extra useful fields
            downloading: downloading[repo],
            license: it.license?.spdx_id,
        }, _.pick(it, ['pushed_at', 'stargazers_count', 'default_branch']))
        return pl
    }))
}

// centralized hosted information, to be used as little as possible
const FN = 'central.json'
let builtIn = JSON.parse(readFileSync(join(__dirname, '..', FN), 'utf8'))
export const getProjectInfo = debounceAsync(
    () => readGithubFile(`${HFS_REPO}/${HFS_REPO_BRANCH}/${FN}`)
        .then(JSON.parse, () => null)
        .then(x => Object.assign({ ...builtIn }, DEV ? null : x) ), // fall back to built-in
    0, { retain: DAY, retainFailure: 60_000 } )