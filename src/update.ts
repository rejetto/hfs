// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiGithubPaginated, getProjectInfo, getRepoInfo } from './github'
import { ARGS_FILE, HFS_REPO, IS_BINARY, IS_WINDOWS, RUNNING_BETA } from './const'
import { dirname, join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { DAY, exists, debounceAsync, httpStream, unzip, prefix, xlate, HOUR } from './misc'
import { createReadStream, existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { pluginsWatcher } from './plugins'
import { chmod, stat } from 'fs/promises'
import { Readable } from 'stream'
import open from 'open'
import { currentVersion, defineConfig, versionToScalar } from './config'
import { cmdEscape, RUNNING_AS_SERVICE } from './util-os'
import { onProcessExit } from './first'
import { storedMap } from './persistence'
import _ from 'lodash'
import { argv } from './argv'

const updateToBeta = defineConfig('update_to_beta', false)
const autoCheckUpdate = defineConfig('auto_check_update', true)
const lastCheckUpdate = storedMap.singleSync<number>('lastCheckUpdate', 0)
const AUTO_CHECK_EVERY = DAY

export const autoCheckUpdateResult = storedMap.singleSync<Release | undefined>('autoCheckUpdateResult', undefined)
autoCheckUpdateResult.ready().then(() => {
    autoCheckUpdateResult.set(v => {
        if (!v) return // refresh isNewer, as currentVersion may have changed
        v.isNewer = currentVersion.olderThan(v.tag_name)
        return v
    })
})
setInterval(debounceAsync(async () => {
    if (!autoCheckUpdate.get()) return
    if (Date.now() < lastCheckUpdate.get() + AUTO_CHECK_EVERY) return
    console.log("checking for updates")
    try {
        const u = (await getUpdates(true))[0]
        if (u) console.log("new version available", u.name)
        autoCheckUpdateResult.set(u)
        lastCheckUpdate.set(Date.now())
    }
    catch {}
}), HOUR)

export type Release = { // not using interface, as it will not work with kvstorage.Jsonable
    prerelease: boolean,
    tag_name: string,
    name: string,
    body: string,
    assets: { name: string, browser_download_url: string }[],
    // fields introduced by us
    isNewer: boolean
    versionScalar: number
}
const ReleaseKeys = ['prerelease', 'tag_name', 'name', 'body', 'assets', 'isNewer', 'versionScalar'] satisfies (keyof Release)[]
const ReleaseAssetKeys = ['name', 'browser_download_url'] satisfies (keyof Release['assets'][0])[]

const curV = currentVersion.getScalar()
function prepareRelease(r: Release) {
    const v = versionToScalar(r.name)
    return Object.assign(_.pick(r, ReleaseKeys), { // prune a bit, as it will be serialized and it has a lot of unused data
        versionScalar: v,
        isNewer: v > curV, // make easy to know what's newer
        assets: r.assets.map((a: any) => _.pick(a, ReleaseAssetKeys))
    })
}

export async function getVersions(interrupt?: (r: Release) => boolean) {
    if (!updateToBeta.get() && !RUNNING_BETA) return []
    const ret: Release[] = []
    for await (const x of apiGithubPaginated(`repos/${HFS_REPO}/releases`)) {
        if (x.name.endsWith('-ignore')) continue
        const rel = prepareRelease(x)
        if (rel.versionScalar === curV) continue
        if (interrupt?.(rel)) break // avoid fetching too much data
        ret.push(rel)
    }
    return _.sortBy(ret, x => -x.versionScalar)
}

export async function getUpdates(strict=false) {
    getProjectInfo() // check for alerts
    const stable: Release = prepareRelease(await getRepoInfo(HFS_REPO + '/releases/latest'))
    const res = await getVersions(r => r.versionScalar < stable.versionScalar) // we don't consider betas before stable
    const ret = res.filter(x => x.prerelease && (strict ? x.isNewer : (x.versionScalar !== currentVersion.getScalar())) )
    if (stable.isNewer || RUNNING_BETA)
        ret.push(stable)
    return ret
}

const LOCAL_UPDATE = 'hfs-update.zip' // update from file takes precedence over net

export function localUpdateAvailable() {
    return exists(LOCAL_UPDATE)
}

export async function updateSupported() {
    return process.env.DISABLE_UPDATE ? false : (argv.forceupdate || IS_BINARY && !await RUNNING_AS_SERVICE)
}

export async function update(tagOrUrl: string='') {
    if (!await updateSupported()) throw "only binary versions supports automatic update for now"
    let doingLocal = ''
    let updateSource: Readable | false = tagOrUrl.includes('://') ? await httpStream(tagOrUrl)
        : await localUpdateAvailable() && createReadStream(doingLocal=LOCAL_UPDATE)
    if (!updateSource) {
        if (/^\d/.test(tagOrUrl)) // work even if the tag is passed without the initial 'v' (useful for console commands)
            tagOrUrl = 'v' + tagOrUrl
        const update = !tagOrUrl ? (await getUpdates(true))[0]
            : await getRepoInfo(HFS_REPO + '/releases/tags/' + tagOrUrl).catch(e => {
                if (e.message === '404') console.error("version not found")
                else throw e
            }) as Release | undefined
        if (!update)
            throw "update not found"
        const plat = '-' + xlate(process.platform, { win32: 'windows', darwin: 'mac' })
        const assetSearch = `${plat}-${process.arch}`
        const legacyAssetSearch = `${plat}${prefix('-', xlate(process.arch, { x64: '', arm64: 'arm' }))}.zip` // legacy pre-0.53.0-rc16
        const asset = update.assets.find((x: any) => x.name.includes(assetSearch) && x.name.endsWith('.zip'))
            || update.assets.find((x: any) => x.name.endsWith(legacyAssetSearch))
        if (!asset)
            throw "asset not found"
        const url = asset.browser_download_url
        console.log("downloading", url)
        updateSource = await httpStream(url)
    }

    const bin = process.execPath
    const binPath = dirname(bin)
    const binFile = 'hfs' + (IS_WINDOWS ? '.exe' : '') // currently running bin could have been renamed
    let newBinFile = binFile
    do { newBinFile = 'new-' + newBinFile }
    while (existsSync(join(binPath, newBinFile)))
    pluginsWatcher.pause()
    try {
        await unzip(updateSource, path =>
            join(binPath, path === binFile ? newBinFile : path))
        const newBin = join(binPath, newBinFile)
        if (!IS_WINDOWS) {
            const { mode } = await stat(bin)
            await chmod(newBin, mode).catch(console.error)
        }
        onProcessExit(() => {
            const oldBinFile = 'old-' + binFile
            console.log("old version is kept as", oldBinFile)
            const oldBin = join(binPath, oldBinFile)
            try { unlinkSync(oldBin) }
            catch {}
            renameSync(bin, oldBin)
            console.log("launching new version in background", newBinFile)
            if (doingLocal)
                try { renameSync(doingLocal, 'old-' + doingLocal) }
                catch(e) { console.warn(e) }
            launch(newBin, ['--updating', binFile, '--cwd .'], { sync: true }) // sync necessary to work on Mac by double-click
        })
        console.log("quitting")
        setTimeout(() => process.exit()) // give time to return (and caller to complete, eg: rest api to reply)
    }
    catch (e: any) {
        pluginsWatcher.unpause()
        throw e?.message || String(e)
    }
}

function launch(cmd: string, pars: string[]=[], options?: { sync: boolean } & Parameters<typeof spawn>[2]) {
    return (options?.sync ? spawnSync : spawn)(cmdEscape(cmd), pars, { detached: true, shell: true, stdio: [0,1,2], ...options })
}

if (argv.updating) { // we were launched with a temporary name, restore original name to avoid breaking references
    const bin = process.execPath
    const dest = join(dirname(bin), argv.updating)
    renameSync(bin, dest)
    // have to relaunch with new name, or otherwise next update will fail with EBUSY on hfs.exe
    console.log("renamed binary file to", argv.updating, "and restarting")
    // be sure to test launching both double-clicking and in a terminal
    if (IS_WINDOWS) // this method on Mac works only once, and without console
        onProcessExit(() =>
            launch(dest, ['--updated', '--cwd .']) ) // launch+sync here would cause old process to stay open, locking ports
    else {
        /* open() is the only consistent way that i could find working on Mac that preserved console input/output over relaunching,
         * but I couldn't find a way to pass parameters, at least on Linux. The workaround I'm using is to write them to a temp file, that's read and deleted at restart.
         * For the record, on mac you can: write "./hfs arg1 arg2" to /tmp/tmp.sh with 0o700, and then spawn "open -a Terminal /tmp/tmp.sh"
         */
        try { writeFileSync(ARGS_FILE, JSON.stringify(['--updated', '--cwd', process.cwd().replaceAll(' ', '\\ ')])) }
        catch {}
        void open(dest)
    }
    process.exit()
}
