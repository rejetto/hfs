// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getRepoInfo } from './github'
import { argv, HFS_REPO, IS_BINARY, IS_WINDOWS, VERSION } from './const'
import { basename, dirname, join } from 'path'
import { spawn } from 'child_process'
import { httpsStream, onProcessExit, unzip } from './misc'
import { createReadStream, renameSync, unlinkSync } from 'fs'
import { pluginsWatcher } from './plugins'
import { access, chmod, stat } from 'fs/promises'
import { Readable } from 'stream'

export async function getUpdate() {
    const [latest] = await getRepoInfo(HFS_REPO + '/releases?per_page=1')
    if (latest.name === VERSION)
        throw "you already have the latest version: " + VERSION
    return latest
}

export async function update() {
    if (!IS_BINARY)
        throw "only binary versions are supported for now"
    const ZIP = 'hfs-update.zip' // update from file takes precedence over net
    let updateSource: Readable | undefined = await access(ZIP).then(() => createReadStream(ZIP), () => undefined)
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
            spawn(newBin, ['--updating', binFile], { detached: true, shell: true, stdio:'inherit' })
                .on('error', console.error)
        })
        console.log('quitting')
        process.exit()
    }
    catch {
        pluginsWatcher.unpause()
    }
}

if (argv.updating) { // we were launched with a temporary name, restore original name to avoid breaking references
    const bin = process.execPath
    const dest = join(dirname(bin), argv.updating)
    renameSync(bin, dest)
    console.log("renamed binary file to", argv.updating)
    // have to relaunch with new name, or otherwise next update will fail with EBUSY on hfs.exe
    onProcessExit(() => {
        spawn(dest, [], { detached: true, shell: true, stdio:'inherit' })
            .on('error', console.error)
    })
    console.log('restarting')
    process.exit()
}
