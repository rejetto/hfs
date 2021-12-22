const fs = require('fs')
const FN = 'src/index.ts'
fs.writeFileSync(FN, fs.readFileSync(FN,'utf8').replace(/(BUILD_TIMESTAMP = ")(.*)"/, '$1'+new Date().toISOString()+'"'))
