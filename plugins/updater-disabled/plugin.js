/*
this plugin is currently working only with exe version.
Its capability is to offer automatic restart when an update is available in the form of hfs.exe-new file.
 */
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

const LOG_PREFIX = "UPDATER PLUGIN:"

exports.init = async api => {
    const fs = api.require('fs')
    fs.writeFile(BATCH_NAME, BATCH, err =>
        err && console.error(LOG_PREFIX, "couldn't write", BATCH_NAME))
    if (!process.env.hfs_updater)
        return console.log(LOG_PREFIX, "run", BATCH_NAME, "to have restart-on-update")

    console.log(LOG_PREFIX, "ready")
    const timer = setInterval(() => {
        fs.access(NEW, fs.constants.W_OK, err => {
            if (err) return
            console.log(LOG_PREFIX, "exiting for update")
            process.exit(0)
        })
    }, 5000)
    return {
        unload() {
            clearInterval(timer)
        }
    }
}
