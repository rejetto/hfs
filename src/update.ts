// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getRepoInfo } from './github'
import { argv, HFS_REPO, IS_BINARY, IS_WINDOWS, VERSION } from './const'
import { basename, dirname, join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { httpsStream, onProcessExit, unzip } from './misc'
import { createReadStream, renameSync, unlinkSync } from 'fs'
import { pluginsWatcher } from './plugins'
import { access, chmod, stat } from 'fs/promises'
import { Readable } from 'stream'
import open from 'open'

export async function getUpdate() {
    const [latest] = await getRepoInfo(HFS_REPO + '/releases?per_page=1')
    if (latest.name === VERSION)
        throw "you already have the latest version: " + VERSION
    return latest
}

const LOCAL_UPDATE = 'hfs-update.zip' // update from file takes precedence over net

export function localUpdateAvailable() {
    return access(LOCAL_UPDATE).then(() => true, () => false)
}

export function updateSupported() {
    return IS_BINARY
}

export async function update() {
    if (!updateSupported())
        throw "only binary versions are supported for now"
    let updateSource: Readable | false = await localUpdateAvailable() && createReadStream(LOCAL_UPDATE)
    if (!updateSource) {
        const update = await getUpdate()
        const assetSearch = ({ win32: 'windows', darwin: 'mac', linux: 'linux' } as any)[process.platform]
        if (!assetSearch)
            throw "this feature doesn't support your platform: " + process.platform
        const asset = update.assets.find((x: any) => x.name.endsWith('.zip') && x.name.includes(assetSearch))
        if (!asset)
            throw "asset not found"
        const url = asset.browser_download_url
        console.log("downloading", url)
        updateSource = await httpsStream(url)
    }

    const bin = process.execPath
    const binPath = dirname(bin)
    const binFile = basename(bin)
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
        console.log('quitting')
        setTimeout(() => process.exit()) // give time to return (and caller to complete, eg: rest api to reply)
    }
    catch {
        pluginsWatcher.unpause()
    }
}

function launch(cmd: string, pars: string[]=[], options?: { sync: boolean } & Parameters<typeof spawn>[2]) {
    return (options?.sync ? spawnSync : spawn)(cmd, pars, { detached: true, shell: true, stdio: [0,1,2], ...options })
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
        open(dest).then()

    process.exit()
}
