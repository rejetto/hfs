const fs = require('fs')
const glob = require('fast-glob')
const { execSync } = require('child_process')
const dist = 'dist/'

console.log('updating build timestamp and version')
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))
const FN = dist+'src/const.js'
fs.writeFileSync(FN,
    fs.readFileSync(FN,'utf8')
        .replace(/(BUILD_TIMESTAMP *= *')(.*)'/, '$1'+new Date().toISOString()+"'")
        .replace(/(VERSION *= *')(.*)'/, '$1'+(pkg.version||'$2')+"'")
)
for (const fn of glob.sync(dist+'node_modules/**/*.map'))
    fs.unlinkSync(fn)

console.log('pruning lodash')
const nm = dist+'node_modules/'
fs.mkdirSync(nm+'lodash2')
fs.cpSync(nm+'lodash/package.json', nm+'lodash2/package.json')
fs.cpSync(nm+'lodash/lodash.min.js', nm+'lodash2/lodash.js')
fs.rmSync(nm+'lodash', {recursive:true})
fs.renameSync(nm+'lodash2', nm+'lodash')

console.log('launching nm-prune')
fs.renameSync(nm+'yaml/dist/doc', nm+'yaml/dist/do_c') // "hide" this folder
execSync('nm-prune --force', { cwd:'dist' })
fs.renameSync(nm+'yaml/dist/do_c', nm+'yaml/dist/doc')

console.log('removing package.json')
fs.unlinkSync(dist+'package.json')
fs.unlinkSync(dist+'package-lock.json')

{
    const fn = dist+'run'
    console.log(fn)
    fs.writeFileSync(fn, 'node src')
    fs.chmodSync(fn, 0o755)
}

console.log('afterbuild done, version', pkg.version)
