const fs = require('fs')
const path = require('path')

async function main() {
    const root = path.resolve(__dirname, '..')
    const dist = path.join(root, 'dist')
    const pkg = require(path.join(root, 'package.json'))
    const lock = require(path.join(root, 'package-lock.json'))
    const distLock = require(path.join(dist, 'npm-shrinkwrap.json'))
    const pkgFetch = require(path.join(root, 'node_modules/@yao-pkg/pkg-fetch/package.json'))
    const patches = require(path.join(root, 'node_modules/@yao-pkg/pkg-fetch/patches/patches.json'))
    const wantedPackages = new Set([lock, distLock].flatMap(currentLock => Object.entries(currentLock.packages)
        .filter(([dir, meta]) => dir.includes('node_modules/') && meta.dev !== true && !meta.link)
        .map(([dir, meta]) => `${packageNameFromLockPath(dir)}@${meta.version}`)))
    const packages = new Map()
    scanNodeModules(path.join(root, 'node_modules'), wantedPackages, packages)
    scanNodeModules(path.join(dist, 'node_modules'), wantedPackages, packages)
    addPackage(path.join(root, 'node_modules/@yao-pkg/pkg'), packages)
    addPackage(path.join(root, 'node_modules/@yao-pkg/pkg-fetch'), packages)

    const nodeMajor = pkg.pkg.targets[0].match(/^node(\d+)/)?.[1]
    const nodeVersion = Object.keys(patches)
        .filter(version => version.match(/^v(\d+)/)?.[1] === nodeMajor)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
    if (!nodeVersion) throw Error(`no pkg-fetch source found for Node ${nodeMajor}`)

    const nodeLicenseUrl = `https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`
    const response = await fetch(nodeLicenseUrl)
    if (!response.ok) throw Error(`cannot download ${nodeLicenseUrl}: ${response.status}`)
    const nodeLicense = await response.text()

    const sections = [
        'HFS third-party notices',
        '=======================',
        '',
        fs.readFileSync(path.join(root, 'THIRD_PARTY_ASSETS.txt'), 'utf8').trim(),
        '',
        `Node.js ${nodeVersion}`,
        '-'.repeat(`Node.js ${nodeVersion}`.length),
        '',
        nodeLicense.trim(),
    ]
    for (const [key, entry] of [...packages].sort(([a], [b]) => a.localeCompare(b)))
        sections.push('', key, '-'.repeat(key.length), '', packageLicense(entry).trim())
    fs.writeFileSync(path.join(dist, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n') + '\n')

    // native prebuilds need exact source mappings because their npm archives contain no source
    const nativeSources = {
        'fs-x-attributes@1.0.2': 'https://github.com/mafintosh/fs-extended-attributes/tree/9b956cf969314b1e9778cb69fd32cc27e29423b7',
        'fswin@3.25.1108': 'https://github.com/xxoo/node-fswin/tree/aea58f997fcb95544b734e2782d3e1e91f2f9222',
    }
    for (const name of ['fs-x-attributes', 'fswin']) {
        const dependency = [...packages.keys()].find(key => key.startsWith(name + '@'))
        if (!nativeSources[dependency]) throw Error(`add the corresponding source for ${dependency}`)
    }

    const patchNames = 'patches' in patches[nodeVersion] ? patches[nodeVersion].patches : patches[nodeVersion]
    const dependencySources = [...new Set([lock, distLock].flatMap(currentLock => Object.entries(currentLock.packages)
        .filter(([dir, meta]) => dir.includes('node_modules/') && meta.dev !== true && !meta.link && meta.resolved)
        .map(([dir, meta]) => `${packageNameFromLockPath(dir)}@${meta.version}: ${meta.resolved}`)))].sort()
    const source = `Corresponding source for HFS ${pkg.version}
=====================================

HFS source for this release:
https://github.com/rejetto/hfs/tree/v${pkg.version}

Exact JavaScript dependency source archives:
${dependencySources.join('\n')}

The executable embeds Node.js ${nodeVersion}, whose source is available at:
https://github.com/nodejs/node/tree/${nodeVersion}

Node.js is patched by @yao-pkg/pkg-fetch ${pkgFetch.version}. Its source and the
patches used for this executable are available at:
https://github.com/yao-pkg/pkg-fetch/tree/v${pkgFetch.version}
${patchNames.map(name => `https://github.com/yao-pkg/pkg-fetch/blob/v${pkgFetch.version}/patches/${name}`).join('\n')}

Sources for bundled native modules whose npm archives contain only prebuilds:
${Object.entries(nativeSources).map(([name, url]) => `${name}: ${url}`).join('\n')}

Build instructions are in dev.md and package.json in the HFS source tree.
`
    fs.writeFileSync(path.join(root, 'SOURCE.txt'), source)
    fs.rmSync(path.join(dist, 'SOURCE.txt'), { force: true })
}

function packageNameFromLockPath(dir) {
    const name = dir.slice(dir.lastIndexOf('node_modules/') + 13)
    return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
}

function scanNodeModules(nodeModules, wantedPackages, packages) {
    if (!fs.existsSync(nodeModules)) return
    for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const dir = path.join(nodeModules, entry.name)
        if (entry.name.startsWith('@')) {
            for (const name of fs.readdirSync(dir)) scanPackage(path.join(dir, name))
        }
        else scanPackage(dir)
    }

    function scanPackage(dir) {
        const packageFile = path.join(dir, 'package.json')
        if (!fs.existsSync(packageFile)) return
        const packageJson = require(packageFile)
        const key = `${packageJson.name}@${packageJson.version}`
        if (wantedPackages.has(key) && !packages.has(key)) packages.set(key, { dir, packageJson })
        scanNodeModules(path.join(dir, 'node_modules'), wantedPackages, packages)
    }
}

function addPackage(dir, packages) {
    const packageJson = require(path.join(dir, 'package.json'))
    packages.set(`${packageJson.name}@${packageJson.version}`, { dir, packageJson })
}

function packageLicense({ dir, packageJson }) {
    const files = fs.readdirSync(dir)
        .filter(name => /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(name))
        .filter(name => fs.statSync(path.join(dir, name)).isFile())
        .sort()
    if (files.length)
        return files.map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n\n')

    const attribution = [
        `Declared license: ${packageJson.license}`,
        packageJson.author && `Author: ${typeof packageJson.author === 'string' ? packageJson.author : JSON.stringify(packageJson.author)}`,
        packageJson.repository && `Repository: ${typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository.url}`,
    ].filter(Boolean).join('\n')
    if (packageJson.license === 'MIT') return attribution + '\n\n' + mitLicense
    if (packageJson.license === 'Unlicense') return attribution + '\n\n' + unlicense
    throw Error(`no license text found for ${packageJson.name}@${packageJson.version}`)
}

const mitLicense = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const unlicense = `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>`

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
