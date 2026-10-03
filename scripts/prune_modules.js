const fs = require('fs')
const glob = require('fast-glob')
const { execSync } = require('child_process')
const dist = 'dist/'
const nm = 'node_modules/'

console.log('launching nm-prune') // must be run from this dir
const ya = dist + nm + 'yaml/dist/'
fs.renameSync(ya+'doc', ya+'do_c') // "hide" this folder from nm-prune
execSync('nm-prune --force -l', { cwd:'dist' })
fs.renameSync(ya+'do_c', ya+'doc')

process.chdir(dist + nm)
console.log('more pruning')
for (const f of [
    'fswin/ia32', 'fswin/arm64', 'node-forge/dist', 'node-forge/flash', 'axios/lib', 'react', 'yaml/browser', 'limiter/dist/esm',
    'axios/dist/browser', 'axios/dist/esm', 'bluebird/js/browser', 'fast-xml-parser/src', 'koa-session/dist/esm',
    'tsyringe/dist/esm5', 'tsyringe/dist/esm2015', 'zod/v4', 'zod/v4-mini',
    ...glob.sync('@peculiar/*/build/es2015', { onlyDirectories: true }),
])
    fs.rmSync(f, { recursive: true, force: true })
fs.rmSync('@peculiar/x509/build/x509.es.js', { force: true })
for (const fn of glob.sync(['fs-x-attributes/prebuilds/win32-*', '**/*.map', '**/*.tsbuildinfo', '**/*.bak', '**/*.ts', '**/license', '**/*.md']))
    fs.unlinkSync(fn)

console.log('pruning lodash')
fs.mkdirSync('lodash2')
fs.cpSync('lodash/package.json', 'lodash2/package.json')
fs.cpSync('lodash/lodash.min.js', 'lodash2/lodash.js')
fs.rmSync('lodash', {recursive:true})
fs.renameSync('lodash2', 'lodash')
