import { Callback, Dict } from "./cross"
import { basename, extname, join } from 'path'
import { watchDir } from './util-files'
import { debounceAsync } from './debounceAsync'
import { readdir } from 'fs/promises'
import { configReady } from './config'

export const ICONS_FOLDER = 'icons'

export type CustomizedIcons = undefined | Dict<string>
export let customizedIcons: CustomizedIcons
configReady.then(() => { // wait for cwd to be defined
    watchIconsFolder('.', v => customizedIcons = v)
})
export function watchIconsFolder(parentFolder: string, cb: Callback<CustomizedIcons>) {
    const iconsFolder = join(parentFolder, ICONS_FOLDER)
    const watcher = watchDir(iconsFolder, debounceAsync(async () => {
        let res: any = {} // reset
        try {
            for (const f of await readdir(iconsFolder, { withFileTypes: true })) {
                if (!f.isFile()) continue
                const k = basename(f.name, extname(f.name))
                res[k] = f.name
            }
            cb(res)
        }
        catch { cb(undefined) } // no such dir
    }), true)
    return () => watcher.stop()
}
