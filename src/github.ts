// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import events from './events'
import {
    httpString, httpStream, unzip, AsapStream, debounceAsync, asyncGeneratorToArray, retry, popKey, onlyTruthy, waitFor,
    HOUR, DAY
} from './misc'
import {
    DISABLING_SUFFIX, enablePlugin, findPluginByRepo, getInactivePlugins, getPluginInfo, isPluginRunning, mapPlugins,
    parsePluginSource, PATH as PLUGINS_PATH, Repo, startPlugin, stopPlugin, STORAGE_FOLDER, DELETE_ME_SUFFIX,
    PLUGIN_MAIN_FILE
} from './plugins'
import { ApiError } from './apiMiddleware'
import _ from 'lodash'
import {
    HFS_REPO, HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FORBIDDEN, HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR, VERSION,
    RUNNING_BETA,
} from './const'
import { access, mkdir, rmdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import fs from 'fs'
import { storedMap } from './persistence'
import { argv } from './argv'
import { expiringCache } from './expiringCache'

const DIST_ROOT = 'dist'

type DownloadStatus = true | undefined
export const downloading: { [repo:string]: DownloadStatus } = {}

function downloadProgress(repo: string, status: DownloadStatus) {
    if (status === undefined)
        delete downloading[repo]
    else
        downloading[repo] = status
    events.emit('pluginDownload', { repo, status })
}

const branchCache = expiringCache<Promise<string>>(DAY)
function getGithubDefaultBranch(repo: string) {
    if (!repo.includes('/'))
        throw 'malformed repo'
    return branchCache.try(repo, async () => {
        for (const b of ['main', 'master']) // try to not consume api quota
            if (await httpString(`https://github.com/${repo}/raw/refs/heads/${b}/dist/plugin.js`, { method: 'HEAD', noRedirect: true }).then(() => 1, () => 0))
                return b
        return (await getRepoInfo(repo))?.default_branch as string
    })
}

export async function downloadPlugin(repo: Repo, { branch='', overwrite=false }={}) {
    if (typeof repo !== 'string')
        repo = repo.main
    if (downloading[repo])
        throw new ApiError(HTTP_CONFLICT, "already downloading")
    const msg = await isPluginBlacklisted(repo) // check before downloading, in case other filters were passed somehow
    if (msg)
        throw new ApiError(HTTP_FORBIDDEN, "blacklisted: " + msg)
    console.log('downloading plugin', repo)
    downloadProgress(repo, true)
    try {
        const pl = findPluginByRepo(repo)
        const customRepo = repo.includes('//')
        if (customRepo) { // custom repo
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
        const folder = overwrite && pl?.id // use existing folder
            || (getFolder2repo().hasOwnProperty(short) ? repo.replace('/','-') // longer form only if another plugin is using short form, to avoid overwriting
                : short.replace(/^hfs-/, ''))
        const GITHUB_ZIP_ROOT = short + '-' + branch // GitHub puts everything within this folder
        return await go(`https://github.com/${repo}/archive/refs/heads/${branch}.zip`, folder, GITHUB_ZIP_ROOT + '/' + DIST_ROOT)

        async function go(url: string, folder: string, zipRoot: string) {
            const installPath = PLUGINS_PATH + '/' + folder
            await access(installPath, fs.constants.W_OK) // early check for permission: access if it exists, mkdir+rmdir if it doesn't
                .catch(() => mkdir(installPath, { recursive: true }).then(() => rmdir(installPath)))
            const tempInstallPath = installPath + '-installing' + DISABLING_SUFFIX
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
            if (!customRepo)
                try {
                    const mainFile = join(tempInstallPath, PLUGIN_MAIN_FILE)
                    const content = await readFile(mainFile, 'utf8')
                    // force github plugins to have correct repo, in case it is missing, wrong, or just outdated after a rename
                    if (repo !== parsePluginSource('', content).repo) {
                        const correct = `exports.repo = ${JSON.stringify(repo)}\n`
                        let newContent = content.replace(/exports.repo\s*=\s*\S*/g, correct)
                        if (newContent === content) // no change = the line is missing
                            newContent = correct + content
                        await writeFile(mainFile, newContent) // first, as our parsing will consider that (unlike javascript)
                    }
                }
                catch (e) { // don't abort the whole procedure just because of the check above. It should never fail, but a user reported a mysterious ENOENT on the readFile()
                    console.warn("plugin's repo check failed", e)
                }
            // ready to replace
            const wasRunning = isPluginRunning(folder)
            if (wasRunning)
                await stopPlugin(folder) // stop old
            // move data, and consider late release of the resource, up to a few seconds
            await retry(() => rename(join(installPath, STORAGE_FOLDER), join(tempInstallPath, STORAGE_FOLDER))
                .then(() => 1, e => e.code === 'ENOENT'))
            // delete old folder (if any), but it may fail in the presence of .node files, so we rename it first as a precaution (clearing require.cache doesn't help). Especially on Windows, it may be impossible to delete dll files until our process is terminated (in which case, retrying is useless).
            const deleteMe = installPath + DELETE_ME_SUFFIX
            await retry(() => rename(installPath, deleteMe).then(() => 1, (e: any) => {
                if (e.code === 'ENOENT') return 1 // nothing to do
                console.warn("error renaming old plugin folder:", String(e))
            }))
            await retry(() => rm(deleteMe, { recursive: true, force: true /*ignore ENOENT*/ }).then(() => 1, e => {
                console.warn("error deleting old plugin folder:", String(e))
            }))
            // final replace
            await rename(tempInstallPath, installPath)
                .catch(e => { throw e.code !== 'ENOENT' ? e : new ApiError(HTTP_NOT_ACCEPTABLE, "missing main file") })
            if (wasRunning)
                if (await waitFor(() => getPluginInfo(folder), { timeout: 10_000 }))
                    void startPlugin(folder) // don't wait, in case it fails to start. We still use startPlugin instead of enablePlugin, as it will take care of disabling other themes.
                        .catch(console.warn)
            events.emit('pluginDownloaded', { id: folder, repo })
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
    const res = await readGithubFile(`${repo}/${branch}/${DIST_ROOT}/${PLUGIN_MAIN_FILE}`)
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
    const ret = Object.fromEntries(getInactivePlugins().map(x => [x.id, x.repo]))
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

export async function *apiGithubPaginated<T=any>(uri: string) {
    uri += uri.includes('?') ? '&' : '?'
    const PAGE_SIZE = 100
    let page = 1
    let n = 0
    try {
        while (1) {
            const res = await apiGithub(uri + `page=${page++}&per_page=${PAGE_SIZE}`)
            const a = res.items || res // "search/repositories" returns an object, while "releases" returns simply an array
            for (const x of a)
                yield x as T
            const now = a.length
            n += now
            if (!now || n >= res.total_count) break
        }
    }
    catch(e: any) {
        if (e.message !== '422') // for some strange reason github api is returning this error if we search repos for a missing user, instead of empty set
            throw e
    }
}

async function isPluginBlacklisted(repo: string) {
    return getProjectInfo().then(x => x?.repo_blacklist?.[repo]?.message as string || '', () => undefined)
}

export async function searchPlugins(text='', { skipRepos=[''] }={}) {
    // github doesn't allow complex search, so we have to do it multiple times and merge the results
    const searches = [
        ...text.split(' ').filter(Boolean).slice(0, 2).map(x => 'user:' + encodeURI(x)), // first 2 words can be the author of the plugin
        encodeURI(text), // search elsewhere, and results after the author search
    ]
    const list = await Promise.all(searches.map(x => asyncGeneratorToArray(apiGithubPaginated(`search/repositories?q=topic:hfs-plugin+${x}`))))
    const deduped = _.uniqBy(list.flat(), x => x.full_name)
    return new AsapStream(deduped.map(async it => { // using AsapStream we parallelize these promises and produce each result as it's ready
        const repo = it.full_name as string
        if (skipRepos.includes(repo) || await isPluginBlacklisted(repo)) return
        const pl = await readOnlineCompatiblePlugin(repo, it.default_branch).catch(() => undefined)
        if (!pl) return
        Object.assign(pl, { // inject some extra useful fields
            repo, // overwrite parsed value, that may be wrong
            downloading: downloading[repo],
            license: it.license?.spdx_id,
        }, _.pick(it, ['pushed_at', 'stargazers_count', 'default_branch']))
        return pl
    }))
}

export const alerts = storedMap.singleSync<string[]>('alerts', [])
const cachedCentralInfo = storedMap.singleSync('cachedCentralInfo', '') // persisting it could also be useful for no-internet instances, so that you can provide a fresher copy
export let blacklistedInstalledPlugins: string[] = []
// centralized hosted information, to be used as little as possible
const FN = 'central.json'
let builtIn = JSON.parse(fs.readFileSync(join(__dirname, '..', FN), 'utf8'))
const branch = RUNNING_BETA ? VERSION.split('.')[1] : 'main'
export const getProjectInfo = debounceAsync(
    () => argv.central === false ? Promise.resolve(builtIn) : readGithubFile(`${HFS_REPO}/${branch}/${FN}`)
        .catch(e => RUNNING_BETA ? readGithubFile(`${HFS_REPO}/main/${FN}`) : Promise.reject(e)) // for beta versions, try again with 'main'
        .then(JSON.parse, () => null)
        .then(o => {
            if (o)
                cachedCentralInfo.set(o)
            o ||= { ...cachedCentralInfo.get() || builtIn } // fall back to built-in
            // merge byVersions info in the main object, but collect alerts separately, to preserve multiple instances
            const allAlerts: string[] = [o.alert]
            for (const [ver, more] of Object.entries(popKey(o, 'byVersion') || {}))
                if (VERSION.match(new RegExp(ver))) {
                    allAlerts.push((more as any).alert)
                    Object.assign(o, more)
                }
            _.remove(allAlerts, x => !x)
            alerts.set(was => {
                if (!_.isEqual(was, allAlerts))
                    for (const a of allAlerts)
                        console.log("ALERT:", a)
                return allAlerts
            })
            const black = onlyTruthy(Object.keys(o.repo_blacklist || {}).map(findPluginByRepo))
            blacklistedInstalledPlugins = onlyTruthy(black.map(x => _.isString(x.repo) && x.repo))
            if (black.length) {
                console.log("blacklisted plugins found:", black.join(', '))
                for (const p of black)
                    enablePlugin(p.id, false)
            }
            return o
        }),
    { retain: HOUR, retainFailure: 60_000 })