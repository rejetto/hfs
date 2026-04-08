// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiGithubPaginated, getProjectInfo, getRepoInfo } from './github'
import { ARGS_FILE, HFS_REPO, IS_BINARY, IS_WINDOWS, IS_MAC, PREVIOUS_TAG, RUNNING_BETA } from './const'
import { dirname, join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { DAY, exists, unzip, prefix, xlate, HOUR, httpStream, statWithTimeout, repeat, debounceAsync } from './misc'
import { createReadStream, existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { pluginsWatcher } from './plugins'
import { chmod, rename, writeFile, rm } from 'fs/promises'
import open from 'open'
import { configReady, currentVersion, defineConfig, versionToScalar } from './config'
import { cmdEscape, runningAsWindowsService } from './util-os'
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
configReady.then(lastCheckUpdate.ready).then(() => repeat(HOUR, () => {
    if (autoCheckUpdate.get() && Date.now() > lastCheckUpdate.get() + AUTO_CHECK_EVERY)
        return checkForUpdates()
}))

export const checkForUpdates = debounceAsync(async () => {
    try {
        const u = await getBestUpdate()
        if (u) console.log("New version available", u.name)
        autoCheckUpdateResult.set(u)
        lastCheckUpdate.set(Date.now())
    }
    catch {}
}, { reuseRunning: true })

export async function getBestUpdate() {
    return (await getUpdates(true))[0]
}

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

const curV = currentVersion.scalar
function prepareRelease(r: Release) {
    const v = versionToScalar(r.name)
    return Object.assign(_.pick(r, ReleaseKeys), { // prune a bit, as it will be serialized and it has a lot of unused data
        versionScalar: v,
        isNewer: v > curV, // make easy to know what's newer
        assets: r.assets.map((a: any) => _.pick(a, ReleaseAssetKeys))
    })
}

export async function getVersions(filter?: (r: Release) => boolean, max=30) {
    const ret: Release[] = []
    for await (const x of apiGithubPaginated(`repos/${HFS_REPO}/releases`)) {
        if (x.name.endsWith('-ignore')) continue
        const rel = prepareRelease(x)
        if (rel.versionScalar === curV) continue
        if (!filter || filter(rel))
            ret.push(rel)
        if (ret.length >= max) break
    }
    return _.sortBy(ret, x => -x.versionScalar)
}

export async function getUpdates(strict=false) {
    console.log("Checking for updates")
    void getProjectInfo() // also check for alerts and print them asap in the console
    const stable: Release = prepareRelease(await getRepoInfo(HFS_REPO + '/releases/latest'))
    const includeBetas = updateToBeta.get() || RUNNING_BETA
    // we don't consider betas before stable
    const betas = !includeBetas ? [] : await getVersions(x => x.prerelease && x.versionScalar > stable.versionScalar && (!strict || x.isNewer))
    if (stable.isNewer || RUNNING_BETA && !strict)
        betas.push(stable)
    return betas
}

const LOCAL_UPDATE = 'hfs-update.zip' // update from file takes precedence over net
const INSTALLED_FN = 'hfs-installed.zip'
const PREVIOUS_FN = 'hfs-previous.zip'

export function localUpdateAvailable() {
    return exists(LOCAL_UPDATE)
}

export function previousAvailable() {
    return exists(PREVIOUS_FN)
}

export function updateSupported() {
    return !process.env.DISABLE_UPDATE && (argv.forceupdate || IS_BINARY)
}

export async function update(tagOrUrl: string='') {
    if (!updateSupported())
        throw process.env.DISABLE_UPDATE ? "Automatic updates are disabled"
            : "Only binary versions support automatic updates"
    let url = tagOrUrl.includes('://') && tagOrUrl
    if (tagOrUrl === PREVIOUS_TAG)
        await rename(PREVIOUS_FN, LOCAL_UPDATE)
    else if (tagOrUrl ? !url : !await localUpdateAvailable()) {
        if (/^\d/.test(tagOrUrl)) // work even if the tag is passed without the initial 'v' (useful for console commands)
            tagOrUrl = 'v' + tagOrUrl
        const update = !tagOrUrl ? await getBestUpdate()
            : await getRepoInfo(HFS_REPO + '/releases/tags/' + tagOrUrl).catch(e => {
                if (e.message === '404') console.error("Version not found")
                else throw e
            }) as Release | undefined
        if (!update)
            throw "No update has been found"
        const plat = '-' + xlate(process.platform, { win32: 'windows', darwin: 'mac' })
        const assetSearch = `${plat}-${process.arch}`
        const legacyAssetSearch = `${plat}${prefix('-', xlate(process.arch, { x64: '', arm64: 'arm' }))}.zip` // legacy pre-0.53.0-rc16
        const asset = update.assets.find((x: any) => x.name.includes(assetSearch) && x.name.endsWith('.zip'))
            || update.assets.find((x: any) => x.name.endsWith(legacyAssetSearch))
        if (!asset)
            throw `Asset not found: ${assetSearch}`
        url = asset.browser_download_url
    }
    if (url) {
        console.log("Downloading", url)
        const temp = LOCAL_UPDATE + '-temp'
        await rm(temp, { force: true })
        try {
            await writeFile(temp, await httpStream(url))
        }
        catch(e: any) {
            await rm(temp).catch(() => {}) // no leftovers
            throw "Download failed for " + url + prefix(' – ', e?.message)
        }
        await rename(temp, LOCAL_UPDATE)
        console.debug("Download finished")
    }
    const bin = process.execPath
    const binPath = dirname(bin)
    const binFile = 'hfs' + (IS_WINDOWS ? '.exe' : '') // the bin we are currently running could have been renamed
    let newBinFile = binFile
    do { newBinFile = 'new-' + newBinFile }
    while (existsSync(join(binPath, newBinFile)))
    pluginsWatcher.pause()
    try {
        await unzip(createReadStream(LOCAL_UPDATE), path =>
            join(binPath, path === binFile ? newBinFile : path))
        const newBin = join(binPath, newBinFile)
        if (!existsSync(newBin)) {
            if (url) // the file was downloaded, and the UI would show the "update from local file" button until we remove it
                await rm(LOCAL_UPDATE).catch(e => console.warn(String(e)))
            throw "Missing executable in the archive"
        }
        if (!IS_WINDOWS) {
            const { mode } = await statWithTimeout(bin)
            await chmod(newBin, mode).catch(console.error)
        }
        await rename(INSTALLED_FN, PREVIOUS_FN).catch(e => e?.code !== 'ENOENT' && console.warn(String(e)))
        await rename(LOCAL_UPDATE, INSTALLED_FN).catch(e => console.warn(String(e)))
        // the bridge process exists to preserve terminal access; skip it when there's no terminal
        const preserveTerminal = process.stdin.isTTY && !await runningAsWindowsService // NSSM fakes a TTY, so we need explicit detection on Windows
        onProcessExit(() => {
            const oldBinFile = 'old-' + binFile
            const oldBin = join(binPath, oldBinFile)
            try { unlinkSync(oldBin) }
            catch {}
            renameSync(bin, oldBin)
            if (!preserveTerminal) {
                renameSync(newBin, join(binPath, binFile))
                console.log("Updated binary in place, exiting for process supervisor to restart")
                return
            }
            // preserving the terminal requires a longer trip
            console.log("Launching new version in background", newBinFile)
            spawnSync(cmdEscape(newBin), ['--updating', binFile, '--cwd .'], { shell: true, stdio: [0,1,2] }) // sync necessary to work on Mac by double-click
        })
        console.log("Quitting")
        setTimeout(() => process.exit()) // give time to return (and caller to complete, eg: rest api to reply)
    }
    catch (e: any) {
        pluginsWatcher.unpause()
        throw e?.message || String(e)
    }
}

if (argv.updating) { // we were launched with a temporary name, restore original name to avoid breaking references
    const bin = process.execPath
    const dest = join(dirname(bin), argv.updating)
    renameSync(bin, dest)
    // have to relaunch with the new name, or otherwise the next update will fail with EBUSY on hfs.exe
    console.log(`Renamed binary file to "${argv.updating}" and now restarting`)
    // if you change anything, be sure to test launching both double-clicking and in a terminal
    if (IS_WINDOWS) // windows-only; this method on mac+linux works only once, and without the console
        onProcessExit(() =>
            spawn(cmdEscape(dest), ['--updated', '--cwd .'], { detached: true, shell: true, stdio: [0,1,2] }) ) // launch+sync here would cause the old process to stay open, locking ports
    else if (IS_MAC) {
        // open() is the only consistent way that I could find working on macos preserving console input/output over relaunching,
        // and it doesn't let us pass cli arguments, so we pass them through a temp file consumed at the next startup.
        // For the record, on mac you can: write "./hfs arg1 arg2" to /tmp/tmp.sh with 0o700, and then spawn "open -a Terminal /tmp/tmp.sh"
        try { writeFileSync(ARGS_FILE, JSON.stringify(['--updated', '--cwd', process.cwd()])) }
        catch {}
        console.log('Open-ing')
        void open(dest)
    }
    else // linux and *nix on terminal: in interactive terminals, block this bridge process on the restarted hfs so the terminal session stays attached
        spawnSync(dest, ['--updated', '--cwd', process.cwd()], { stdio: [0, 1, 2] })
    process.exit()
}
