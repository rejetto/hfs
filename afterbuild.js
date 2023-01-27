const fs = require('fs')

console.log('updating build timestamp and version')
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))

process.chdir('dist')
const FN = 'src/const.js'
fs.writeFileSync(FN,
    fs.readFileSync(FN,'utf8')
        .replace(/(BUILD_TIMESTAMP *= *)(fs.*)(;\r?\n)/, '$1"'+new Date().toISOString()+'"$3')
)
console.log('afterbuild done, version', pkg.version)
