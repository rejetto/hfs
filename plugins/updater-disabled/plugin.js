/*
this plugin is currently experimental and working only with exe version.
Its capability is to offer automatic restart when an update is available in the form of hfs.exe-new file.
*/
exports.version = 0.1
exports.description = "automatic restart when an update is available in the form of hfs.exe-new file"
exports.apiRequired = 3 // api.log

const NEW = 'hfs.exe-new'
const BATCH_NAME = 'run-updater.bat'
const BATCH = `@echo off
:loop
setlocal
SET hfs_updater=1
hfs
endlocal
if exist hfs.exe-new (
  move /y hfs.exe hfs.exe-old
  move /y ${NEW} hfs.exe
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
        fs.access(NEW, fs.constants.W_OK, err => {
            if (err) return
            api.log("exiting for update")
            process.exit(0)
        })
    }, 5000)
    return {
        unload() {
            clearInterval(timer)
        }
    }
}
