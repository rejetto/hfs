// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getRepoInfo } from './github'
import { argv, HFS_REPO, IS_BINARY, IS_WINDOWS, RUNNING_BETA } from './const'
import { dirname, join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { exists, httpStream, prefix, unzip, xlate } from './misc'
import { createReadStream, renameSync, unlinkSync } from 'fs'
import { pluginsWatcher } from './plugins'
import { chmod, stat } from 'fs/promises'
import { Readable } from 'stream'
import open from 'open'
import { currentVersion, defineConfig, versionToScalar } from './config'
import { cmdEscape, RUNNING_AS_SERVICE } from './util-os'
import { onProcessExit } from './first'

const updateToBeta = defineConfig('update_to_beta', false)

interface Release {
    prerelease: boolean,
    tag_name: string,
    name: string,
    assets: any[],
    isNewer: boolean // introduced by us
}

export async function getUpdates(strict=false) {
    const stable: Release = await getRepoInfo(HFS_REPO + '/releases/latest')
    const verStable = ver(stable)
    const ret = await getBetas()
    stable.isNewer = currentVersion.olderThan(stable.tag_name)
    if (stable.isNewer || RUNNING_BETA)
        ret.push(stable)
    return ret.filter(x => !strict || x.isNewer)

    function ver(x: any) {
        return versionToScalar(x.name)
    }

    async function getBetas() {
        if (!updateToBeta.get() && !RUNNING_BETA) return []
        let page = 1
        const ret = []
        while (1) {
            const per = 100
            const res: Release[] = await getRepoInfo(HFS_REPO + `/releases?per_page=${per}&page=${page++}`)
            if (!res.length) break
            const curV = currentVersion.getScalar()
            for (const x of res) {
                if (!x.prerelease) continue // prerelease are all the end
                const v = ver(x)
                if (v <= verStable) // prerelease-s are locally ordered, so as soon as we reach verStable we are done
                    return ret
                if (v === curV) continue // skip current
                x.isNewer = v > curV // make easy to know what's newer
                ret.push(x)
            }
        }
        return ret
    }
}

const LOCAL_UPDATE = 'hfs-update.zip' // update from file takes precedence over net

export function localUpdateAvailable() {
    return exists(LOCAL_UPDATE)
}

export async function updateSupported() {
    return argv.forceupdate || IS_BINARY && !await RUNNING_AS_SERVICE
}

export async function update(tagOrUrl: string='') {
    if (!await updateSupported()) throw "only binary versions supports automatic update for now"
    let updateSource: Readable | false = tagOrUrl.includes('://') ? await httpStream(tagOrUrl)
        : await localUpdateAvailable() && createReadStream(LOCAL_UPDATE)
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
    const newBinFile = 'new-' + binFile
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
            launch(newBin, ['--updating', binFile], { sync: true }) // sync necessary to work on mac by double-click
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
            launch(dest, ['--updated']) ) // launch+sync here would cause old process to stay open, locking ports
    else
        void open(dest)

    process.exit()
}
