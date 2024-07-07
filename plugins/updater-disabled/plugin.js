/*
This plugin is currently experimental and working only with exe version.
Its capability is to offer automatic restart when an update is available in the form of hfs.exe-new file.

Tip: In my case I'm uploading "hfs.exe-new" over ftp, and it's a bit slow, so to avoid the plugin to catch
    an unfinished file, I do the upload using a temporary name, and only when it's done I rename it to "hfs.exe-new".
*/
exports.version = 0.3
exports.description = "automatic restart when an update is available in the form of hfs.exe-new file"
exports.apiRequired = 3 // api.log

const NEW = 'hfs.exe-new'
const UPDATING = 'hfs.exe-updating'
const BATCH_NAME = 'run-updater.bat'
const BATCH = `@echo off
:loop
setlocal
SET hfs_updater=1
hfs %*
endlocal
if exist hfs.exe-new (
  move /y hfs.exe hfs.exe-old
  move /y ${UPDATING} hfs.exe
  goto loop  
)
`

exports.init = async api => {
    const fs = api.require('fs')
    fs.writeFile(BATCH_NAME, BATCH, err =>
        err && api.log("couldn't write", BATCH_NAME))
    if (!process.env.hfs_updater)
        return api.log("run", BATCH_NAME, "to have restart-on-update")

    api.log("ready")
    const timer = setInterval(() => {
        fs.rename(NEW, UPDATING, err => {
            if (err) return
            api.log("exiting for update")
            process.emit('SIGTERM')
        })
    }, 5000)
    return {
        unload() {
            clearInterval(timer)
        }
    }
}
