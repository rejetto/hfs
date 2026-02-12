import test, { describe, before, after } from 'node:test';
import { promisify } from 'util'
import { srpClientSequence } from '../src/srp'
import { createReadStream, existsSync, readFileSync, statfsSync, statSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { exec } from 'child_process'
import _ from 'lodash'
import yaml from 'yaml'
import { findDefined, pathEncode, randomId, try_, tryJson, UPLOAD_TEMP_HASH, wait } from '../src/cross'
import { httpStream, stream2string, XRequestOptions } from '../src/util-http'
import { ThrottledStream, ThrottleGroup } from '../src/ThrottledStream'
import { mkdir, rm, rename, writeFile, access } from 'fs/promises'
import { Readable } from 'stream'
/*
import { PORT, srv } from '../src'

process.chdir('..')
const appStarted = new Promise(resolve =>
    srv.on( 'app_started', resolve) )
*/

const username = 'rejetto'
const password = 'password'
const auth = `${username}:${password}`
const API = '/~/api/'
const ROOT = 'tests/'
const TEST_PORT = Number(yaml.parse(readFileSync(resolve(__dirname, 'config.yaml'), 'utf8')).port)
const BASE_URL = `http://[::1]:${TEST_PORT}`
const BASE_URL_127 = `http://127.0.0.1:${TEST_PORT}`
const UPLOAD_ROOT = '/for-admins/upload/'
const VIRTUAL_UPLOAD_ROOT = '/renameChild/'
const FUNNY_NAME = 'x%25#x'
const FUNNY_NAME_ENCODED = '/x%2525%23x'
const UPLOAD_DIR = 'temp'
const CANT_OVERWRITE_NAME = 'cant-overwrite'
const CANT_OVERWRITE_URI = `/for-admins/${CANT_OVERWRITE_NAME}/`
const UPLOAD_RELATIVE = `${UPLOAD_DIR}/gpl.png`
const UPLOAD_DEST = UPLOAD_ROOT + UPLOAD_RELATIVE
const BIG_CONTENT = _.repeat(randomId(10), 300_000) // 3MB, big enough to saturate buffers
const throttle = BIG_CONTENT.length /1000 /0.8 // KB, finish in 0.8s, quick but still overlapping downloads
const SAMPLE_FILE_PATH = resolve(__dirname, 'page/gpl.png')
let defaultBaseUrl = BASE_URL

const execP = (cmd: string) => promisify(exec)(cmd).then(x => x.stdout)

describe('basics', () => {
    //before(async () => appStarted)
    test('frontend', req('/', /<body>/, { headers: { accept: '*/*' } })) // workaround: 'accept' is necessary when running server-for-test-dev, still don't know why
    test('force slash', req('/f1', 302, { noRedirect: true }))
    test('list', reqList('/f1/', { inList:['f2/', 'page/'] }))
    test('search', reqList('f1', { inList:['f2/'], outList:['page'] }, { search:'2' }))
    test('search root', reqList('/', { inList:['cantListPage/'], outList:['cantListPage/page/'] }, { search:'page' }))
    test('download.mime', req('/f1/f2/alfa.txt', { re:/abcd/, mime:'text/plain' }))
    test('download.not modified', async () => {
        let lm = ''
        await req('/f1/f2/alfa.txt', (_data, res) => lm = res.headers?.['last-modified'])()
        if (!lm)
            throw "last-modified"
        await req('/f1/f2/alfa.txt', { status: 304, empty: true }, { headers: { 'If-Modified-Since': lm } })()
    })
    test('download.if-range', async () => {
        let etag = ''
        await req('/f1/f2/alfa.txt', (_data, res) => etag = res.headers?.etag)()
        if (!etag)
            throw "missing etag"
        await req('/f1/f2/alfa.txt', /a[^d]+$/, { headers: { Range: 'bytes=0-2', 'If-Range': etag } })() // only "abc" is expected
    })
    test('download.partial', req('/f1/f2/alfa.txt', /a[^d]+$/, { headers: { Range: 'bytes=0-2' } })) // only "abc" is expected
    test('bad range', req('/f1/f2/alfa.txt', 416, { headers: { Range: 'bytes=7-' } }))
    test('bad range.inverted', req('/f1/f2/alfa.txt', 416, { headers: { Range: 'bytes=3-2' } }))
    test('bad range.malformed', req('/f1/f2/alfa.txt', 400, { headers: { Range: 'bytes=abc-def' } }))
    test('roots', req('/f2/alfa.txt', 200, { baseUrl: BASE_URL_127 })) // host 127.0.0.1 is rooted in /f1
    test('website', req('/f1/page/', { re:/This is a test/, mime:'text/html' }))
    test('traversal', req('/f1/page/.%2e/.%2e/README.md', 404))
    test('traversal.double-encoded', req('/f1/page/%252e%252e/%252e%252e/README.md', 404))
    test('traversal.encoded-slash', req('/f1/page/%2e%2e%2f%2e%2e%2fREADME.md', 404))
    test('traversal.backslash', req('/f1/page/..%5c..%5cREADME.md', 404))
    test('traversal.to-admin', req('/f1/page/%2e%2e/%2e%2e/for-admins/alfa.txt', 404))
    test('traversal.mixed-dots', req('/f1/page/.%2e/%2e./README.md', 404))
    test('traversal.overlong-utf8', req('/f1/page/%c0%ae%c0%ae/%c0%ae%c0%ae/README.md', 404))
    test('bad url encoding', req('/f1/%E0%A4%A', 404))
    test('custom mime from above', req('/tests/page/index.html', { status: 200, mime:'text/plain' }))
    test('name encoding', req(FUNNY_NAME_ENCODED, 200))
    test('name encoding list', reqList('/', { inList: [FUNNY_NAME] }))
    test('name encoding search', reqList('/', { inList: [FUNNY_NAME] }, { search: FUNNY_NAME }))

    test('missing perm', reqList('/for-admins/', 401))
    test('missing perm.file', req('/for-admins/alfa.txt', 401))
    test('missing anti-csrf', reqApi('rename', { uri: '/f1', dest: 'x' }, 418, { headers: {} })) // overriding anti-csrf
    test('malformed body', reqApi('rename', { uri: '/f1', dest: 'x' }, { status: 400 }, {
        headers: { 'x-hfs-anti-csrf': '1', 'content-type': 'application/json' },
        body: '{'
    }))
    test('file_details.missing', reqApi('get_file_details', { uris: ['/missing'] }, res => res?.details?.[0] === false))
    test('file_details.hidden', reqApi('get_file_details', { uris: ['/tests/config.yaml'] }, res => res?.details?.[0] === false))
    test('file_details.for-admins', reqApi('get_file_details', { uris: ['/for-admins/alfa.txt'] }, res => res?.details?.[0] === false))
    test('file_details.traversal', reqApi('get_file_details', { uris: ['/f1/%2e%2e/for-admins/alfa.txt'] }, res => res?.details?.[0] === false))
    test('file_list.traversal', reqApi('get_file_list', { uri: '/f1/%2e%2e/for-admins' }, 404))
    test('file_list.bad encoding', reqApi('get_file_list', { uri: '/f1/%E0%A4%A' }, 404))
    test('forbidden list', req('/cantListPage/page/', 403))
    test('forbidden list.api', reqList('/cantListPage/page/', 403))
    test('forbidden list.admin flag', reqApi('get_file_list', { uri: '/for-admins/', admin: true }, 401))
    test('forbidden list.cant see', reqList('/cantListPage/', { outList:['page/'] }))
    test('forbidden list.but readable file', req('/cantListPage/page/gpl.png', 200))
    test('forbidden list.alternative method', reqList('/cantListPageAlt/page/', 403))
    test('forbidden list.match **', req('/cantListPageAlt/page/gpl.png', 401))

    test('cantListBut', reqList('/cantListBut/', 403))
    test('cantListBut.zip', req('/cantListBut/?get=zip', 403))
    test('cantListBut.parent', reqList('/', { permInList: { 'cantListBut/': 'l' } }))
    test('cantListBut.child masked', reqList('/cantListBut/page', 200))
    test('cantSearchForMasks', reqList('/', { outList: ['cantSearchForMasks/page/gpl.png'] }, { search: 'gpl' }))
    test('cantReadBut', reqList('/cantReadBut/', 403))
    test('cantReadBut.can', req('/cantReadBut/alfa.txt', 200))
    test('cantReadBut.parent', reqList('/', { permInList: { 'cantReadBut/': '!r' } }))
    test('cantReadButChild', req('/cantReadButChild/alfa.txt', 401))
    test('cantReadButChild.parent', reqList('/', { permInList: { 'cantReadButChild/': 'R' } }))

    test('cantReadPage', reqList('/cantReadPage/page', 403))
    test('cantReadPage.zip', req('/cantReadPage/page/?get=zip', 403, { method:'HEAD' }))
    test('cantReadPage.file', req('/cantReadPage/page/gpl.png', 403))
    test('cantReadPage.parent', reqList('/cantReadPage', { permInList: { 'page/': 'lr' } }))
    test('cantReadRealFolder', reqList('/cantReadRealFolder', 403))
    test('cantReadRealFolder.file', req('/cantReadRealFolder/page/gpl.png', 403))

    test('renameChild', reqList('/renameChild/tests', { inList:['renamed1'] }))
    test('renameChild.get', req('/renameChild/tests/renamed1', /abc/))
    test('renameChild.deeper', reqList('/renameChild/tests/page', { inList:['renamed2'] }))
    test('renameChild.get deeper', req('/renameChild/tests/page/renamed2', /PNG/))
    test('renameChild.search', reqList('/renameChild/tests', { inList:['renamed1', 'page/renamed2'] }, { search: 'ren' }))

    test('cantSeeThis', reqList('/', { outList:['cantSeeThis/'] }))
    test('cantSeeThis.children', reqList('/cantSeeThis', { outList:['hi/'] }))
    test('cantSeeThisButChildren', reqList('/', { outList:['cantSeeThisButChildren/'] }))
    test('cantSeeThisButChildren.children', reqList('/cantSeeThisButChildren', { inList:['hi/'] }))
    test('cantZipFolder', req('/cantSeeThisButChildren/?get=zip', 403))
    test('cantZipFolder.butChildren', req('/cantSeeThisButChildren/hi/?get=zip', 200))
    test('cantSeeThisButChildrenMasks', reqList('/', { outList:['cantSeeThisButChildrenMasks/'] }))
    test('cantSeeThisButChildrenMasks.children', reqList('/cantSeeThisButChildrenMasks', { inList:['hi/'] }))

    test('masks.only', reqList('/cantSeeThisButChildren/hi', { inList:['page/'] }))
    test('masks.only.fromDisk', reqList('/cantSeeThisButChildren/hi/page', 403))
    test('masks.only.fromDisk.file', req('/cantSeeThisButChildren/hi/page/gpl.png', 403))

    test('protectFromAbove', req('/protectFromAbove/child/alfa.txt', 403))
    test('protectFromAbove.list', reqList('/protectFromAbove/child/', { inList:['alfa.txt'] }))
    test('inheritNegativeMask', reqList('/tests/page', { outList: ['index.html'] }))

    const zipSize = 13242
    const zipOfs = 0x194E
    const zipLength = 4
    test('zip.head', req('/f1/?get=zip', { empty:true, length:zipSize }, { method:'HEAD' }) )
    test('zip.partial', req('/f1/?get=zip', { re:/^page$/, length: zipLength }, { headers: { Range: `bytes=${zipOfs}-${zipOfs+zipLength-1}` } }) )
    test('zip.partial.resume', req('/f1/?get=zip', { re:/^page/, length:zipSize-zipOfs }, { headers: { Range: `bytes=${zipOfs}-` } }) )
    test('zip.partial.end', req('/f1/f2/?get=zip', { re:/^6/, length:10 }, { headers: { Range: 'bytes=-10' } }) )
    test('zip.list.bad encoding', req('/f1/?get=zip&list=%E0%A4%A//%00', { status: 200, length: 22 })) // basically empty
    test('zip.list.null filename', req('/f1/?get=zip&list=%00', 400)) // tries to name the output with null-byte
    test('zip.alfa is forbidden', req('/protectFromAbove/child/?get=zip&list=alfa.txt//renamed', { empty: true, length:134 }, { method:'HEAD' }))
    test('zip.cantReadPage', req('/cantReadPage/?get=zip', { length: 4832 }, { method:'HEAD' }))

    test('referer', req('/f1/page/gpl.png', 403, {
        headers: { Referer: 'https://some-website.com/try-to-trick/x.com/' }
    }))

    test('upload.need account', reqUpload( UPLOAD_DEST, 401))
    test('upload.post', async () => { // this is also testing basic-auth
        const output = await execP(`curl -u ${auth} -F upload=@${SAMPLE_FILE_PATH} ${BASE_URL}${UPLOAD_ROOT}`)
        const uri = tryJson(output)?.uris?.[0]
        if (!uri) throw "unexpected output " + output
        const fn = resolve(__dirname, basename(decodeURI(uri)))
        const stats = statSync(fn)
        rm(fn).catch(() => {}) // clear
        if (stats?.size !== statSync(SAMPLE_FILE_PATH).size)
            throw "unexpected size for " + fn
    })
    test('upload.post.virtual folder', async () => {
        const { status } = await curlWithStatus(`curl -s -u ${auth} -F upload=@${SAMPLE_FILE_PATH} ${BASE_URL}${VIRTUAL_UPLOAD_ROOT}`)
        if (status !== 403)
            throw "unexpected status " + status
    })
    test('upload.put.virtual folder', reqUpload(`${VIRTUAL_UPLOAD_ROOT}gpl.png`, 403))
    test('upload.post.empty filename', async () => {
        const boundary = '----hfs-boundary'
        const body = `--${boundary}\\r\\nContent-Disposition: form-data; name="upload"; filename=""\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\nX\\r\\n--${boundary}--\\r\\n`
        const { status, body: responseBody } = await curlWithStatus(`printf '%b' "${body}" | curl -s -u ${auth} -H "Content-Type: multipart/form-data; boundary=${boundary}" --data-binary @- ${BASE_URL}${UPLOAD_ROOT}`)
        if (status !== 400)
            throw "unexpected status " + status
        const errMsg = tryJson(responseBody)?.errors?.[0]
        if (!['empty filename', 'no files'].includes(errMsg))
            throw 'missing error'
    })
    test('upload.post.absolute filename', async () => {
        const absPath = resolve(__dirname, `abs-${randomId(6)}.txt`)
        const absForBody = absPath.replace(/\\\\/g, '/')
        const storedPath = resolve(__dirname, 'tmp', basename(absPath))
        try {
            const { status } = await curlWithStatus(`curl -s -u ${auth} -H "x-hfs-wait: 1" -F "upload=@${SAMPLE_FILE_PATH};filename=${absForBody}" ${BASE_URL}${UPLOAD_ROOT}`)
            throwIf(status !== 418 ? "unexpected status " + status
                : existsSync(absPath) ? "absolute path accepted"
                    : existsSync(storedPath) ? "stored file escaped" : '')
        }
        finally {
            await Promise.all([rmAny(absPath), rmAny(storedPath)])
        }
    })
    test('create_folder', reqApi('create_folder', { uri: UPLOAD_ROOT, name: UPLOAD_DIR }, 401))
    test('create_folder.bad type', reqApi('create_folder', { uri: UPLOAD_ROOT, name: 123 }, { status: 400, re: /name/ }))
    test('delete.no perm', req('/for-admins/', 405, { method: 'delete' }))
    test('delete.need account', req(UPLOAD_ROOT + 'alfa.txt', 401, { method: 'delete'}))
    test('rename.no perm', reqApi('rename', { uri: '/for-admins', dest: 'any' }, 403))

    test('create_folder.bad encoding', reqApi('comment', { uri: '%a' }, 400))
    test('comment.bad encoding', reqApi('comment', { uri: '%a', comment: 'anything' }, 400))
    test('rename.bad encoding', reqApi('rename', { uri: '%a', dest: 'anything' }, 400))
    test('move_files.bad encoding', reqApi('move_files', { uri_from: ['%a'], uri_to: '%a' }, 400))

    test('folder size', reqApi('get_folder_size', { uri: 'f1/page' }, res => res.bytes === 6328 ))
    test('folder size.cant', reqApi('get_folder_size', { uri: 'for-admins' }, 401))

    test('get_accounts', reqApi('get_accounts', {}, 401)) // admin api requires login
    test('url login', async () => {
        const output = await execP(`curl -s -D - -o /dev/null "${BASE_URL}/for-admins/?login=${auth}"`)
        if (!/^(location|set-cookie):/im.test(output))
            throw "failed"
    })
})

// do this before login, or max_dl_accounts config will override max_dl
describe('limits', () => {
    const fn = ROOT + 'big'
    before(() => writeFile(fn, BIG_CONTENT))
    test('max_dl', () => testMaxDl('/' + fn, 1, 2))
    after(() => rm(fn))
})

describe('sessions', () => {
    test('of_disabled.cantLogin', () => login('of_disabled').then(() => { throw "in" }, () => {}))
    test('allow_net.canLogin', () => login(username))
    test('allow_net.cantLogin', () => {
        defaultBaseUrl = BASE_URL_127 // 127.0.0.1 is not allowed for this account
        return login(username).then(() => { throw "in" }, () => {})
            .finally(() => defaultBaseUrl = BASE_URL)
    })
    test('allow_net.cantLogin.url', reqList('protected', 401, {}, { baseUrl: BASE_URL_127, auth }))
    test('httpStream.jar isolates host cookies', async () => {
        const jar = {}
        await reqApi('loginSrp1', { username }, res => Boolean(res?.salt && res?.pubKey), { jar })()
        await reqApi('loginSrp2', { pubKey: '1', proof: '1' }, 409, { baseUrl: BASE_URL_127, jar })()
        await reqApi('loginSrp2', { pubKey: '1', proof: '1' }, 401, { jar })()
    })
    test('allow_net.recovers after restriction is removed', async () => {
        const user = `allow-net-${randomId(6)}`.toLowerCase()
        const pwd = `pw-${randomId(8)}`
        const userAuth = `${user}:${pwd}`
        const userJar = {}
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: user, overwrite: true, password: pwd }, res => res?.username === user, adminReq)()
            await reqApi('refresh_session', {}, res => res?.username === user, { jar: userJar, auth: userAuth })()
            await reqApi('set_account', { username: user, changes: { allow_net: '127.0.0.1' } }, 200, adminReq)() // block
            await reqApi('refresh_session', {}, res => !res?.username, { jar: userJar })() // kicked out
            await reqApi('set_account', { username: user, changes: { allow_net: '' } }, 200, adminReq)() // re-enable
            await reqApi('refresh_session', {}, res => res?.username === user, { jar: userJar, auth: userAuth })()
        }
        finally {
            await reqApi('del_account', { username: user }, 200, adminReq)().catch(() => {})
        }
    })
})

describe('accounts', () => {
    before(() => login(username))
    test('get_accounts', reqApi('get_accounts', {}, ({ list }) => _.find(list, { username }) && _.find(list, { username: 'admins' })))
    const add = 'test-Add'
    test('accounts.add', reqApi('add_account', { username: add, overwrite: true }, res => res?.username === add.toLowerCase()))
    test('accounts.remove', reqApi('del_account', { username: add }, 200))
    test('accounts.remove array', reqApi('del_account', { username: [add] }, x => x.errors[add] === 404))
})

describe('after-login', () => {
    before(() => login(username))
    const trickyChars = '%strange#'
    test('create_folder', reqApi('create_folder', { uri: UPLOAD_ROOT, name: UPLOAD_DIR }, 200))
    test('create_folder.empty name', reqApi('create_folder', { uri: UPLOAD_ROOT, name: '' }, 409))
    test('create_folder.tricky chars', async () => {
        await reqApi('create_folder', { uri: UPLOAD_ROOT, name: trickyChars }, 200)()
        const dest = resolve(__dirname, trickyChars)
        await access(dest)
        await rm(dest, { recursive: true })
    })
    test('inherit.perm', reqList('/for-admins/', { inList:['alfa.txt'] }))
    test('inherit.disabled', reqList('/for-disabled/', 401))
    test('rename.to existing folder', async () => {
        const from = 'rename'
        const dest = 'cant-overwrite'
        const baseDir = await ensureCantOverwriteDir()
        const fromPath = resolve(baseDir, from)
        const destPath = resolve(baseDir, dest)
        await writeFile(fromPath, 'from')
        await writeFile(destPath, 'dest')
        try { await reqApi('rename', { uri: CANT_OVERWRITE_URI + from, dest }, 403)() }
        finally {
            await rmAny(baseDir)
        }
    })
    test('upload.never', reqUpload('/random', 403))
    test('upload.ok', reqUpload(UPLOAD_DEST, 200))
    test('move.dest is file', reqApi('move_files', { uri_from: [UPLOAD_DEST], uri_to: UPLOAD_DEST }, 405))
    test('upload.dot name', reqUpload(`${UPLOAD_ROOT}%2e`, 418))
    test('upload.unreadable', reqUpload(`${UPLOAD_ROOT}%0a`, 418))
    test('upload.bad encoding', reqUpload(`${UPLOAD_ROOT}%E0%A4%A`, 404))
    test('upload.temp hash traversal', req(`${UPLOAD_ROOT}%2e%2e?get=${UPLOAD_TEMP_HASH}`, 404))
    test('upload.temp hash requires auth', async () => {
        const rel = `${UPLOAD_DIR}/partial.png`
        await reqUpload(`${UPLOAD_ROOT}${rel}?partial=1`, 204)()
        await req(`${UPLOAD_ROOT}${rel}?get=${UPLOAD_TEMP_HASH}`, 401, { jar: {} })()
    })
    test('upload.temp hash missing', req(`${UPLOAD_ROOT}${UPLOAD_DIR}/missing.png?get=${UPLOAD_TEMP_HASH}`, 404))
    test('file_details.admin', reqApi('get_file_details', { uris: [UPLOAD_DEST] }, res => {
        const u = res?.details?.[0]?.upload
        throwIf(!u?.ip ? 'ip' : u?.username !== username ? 'username' : '')
    }))
    test('file_details.non-admin', reqApi('get_file_details', { uris: [UPLOAD_DEST] }, res => res?.details?.[0] === false, { jar: {} }))
    test('percent name apis.details', async () => {
        const percentName = `x%25-${randomId(4)}`
        const percentUri = `${UPLOAD_ROOT}${pathEncode(percentName)}`
        const comment = `note-${randomId(6)}`
        await reqUpload(percentUri, 200)()
        try {
            await reqApi('get_file_details', { uris: [percentUri] }, res => !!res?.details?.[0]?.upload)()
            await reqApi('comment', { uri: percentUri, comment }, 200)()
            await reqApi('get_file_list', { uri: UPLOAD_ROOT }, res => _.find(res?.list, { n: percentName })?.comment === comment)()
            await reqApi('get_folder_size', { uri: percentUri }, 405)()
        }
        finally {
            await req(percentUri, 200, { method: 'delete' })().catch(() => {})
            await rmAny(resolve(__dirname, percentName))
        }
    })

    test('percent name apis.rename', async () => {
        const percentName = `x%25-${randomId(4)}`
        const percentUri = `${UPLOAD_ROOT}${pathEncode(percentName)}`
        const renameName = `${percentName}-renamed`
        const renamedUri = `${UPLOAD_ROOT}${pathEncode(renameName)}`
        await reqUpload(percentUri, 200)()
        try {
            await reqApi('rename', { uri: percentUri, dest: renameName }, 200)()
            await req(percentUri, 404)()
            await req(renamedUri, 200)()
        }
        finally {
            await req(renamedUri, 200, { method: 'delete' })().catch(() => {})
            await rmAny(resolve(__dirname, renameName))
        }
    })

    test('percent name apis.move-copy', async () => {
        const percentName = `x%25-${randomId(4)}`
        const percentUri = `${UPLOAD_ROOT}${pathEncode(percentName)}`
        const folderName = `pct-${randomId(6)}`
        const folderUri = `${UPLOAD_ROOT}${folderName}/`
        const movedUri = `${UPLOAD_ROOT}${folderName}/${pathEncode(percentName)}`
        await reqUpload(percentUri, 200)()
        try {
            await reqApi('create_folder', { uri: UPLOAD_ROOT, name: folderName }, 200)()
            await reqApi('move_files', { uri_from: [percentUri], uri_to: folderUri }, res => !res?.errors?.[0])()
            await req(movedUri, 200)()
            await reqApi('copy_files', { uri_from: [movedUri], uri_to: UPLOAD_ROOT }, res => !res?.errors?.[0])()
            await req(percentUri, 200)()
        }
        finally {
            await req(percentUri, 200, { method: 'delete' })().catch(() => {})
            await req(movedUri, 200, { method: 'delete' })().catch(() => {})
            await rmAny(resolve(__dirname, percentName))
            await rmAny(resolve(__dirname, folderName, percentName))
            await rmAny(resolve(__dirname, folderName))
        }
    })
    test('zip.no-list but archive', req('/zipNoList/?get=zip', 403, { jar: {} }))
    test('upload but not delete', async () => {
        const name = `cant-delete`
        await mkdir(resolve(__dirname, name), { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../${name}`, name, can_upload: ['admins'], can_delete: false }, 200)()
        try {
            const dest = `${UPLOAD_ROOT}${name}/no-delete.txt`
            await reqUpload(dest, 200)()
            await req(dest, 403, { method: 'delete' })()
        }
        finally {
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(resolve(__dirname, name))
        }
    })
    test('move.overwrite needs delete', async () => {
        const destFile = 'locked.txt'
        const destDir = await ensureCantOverwriteDir()
        const destPath = resolve(destDir, destFile)
        const sourceUri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${destFile}`
        await writeFile(destPath, 'dest')
        try {
            await reqUpload(sourceUri, 200, 'source')()
            const before = statSync(destPath).size
            await reqApi('move_files', { uri_from: [sourceUri], uri_to: CANT_OVERWRITE_URI }, res => res?.errors?.[0] === 403)()
            const after = statSync(destPath).size
            if (after !== before)
                throw "file overwritten"
        }
        finally {
            await rmAny(resolve(__dirname, UPLOAD_DIR, destFile))
            await rmAny(destDir)
        }
    })
    test('upload.path bypass', async () => {
        const name = 'no-upload'
        const targetDir = resolve(__dirname, 'tmp', name)
        try {
            await execP(`curl -g -s -u ${auth} -F "upload=@${SAMPLE_FILE_PATH};filename=${name}/evil.txt" ${BASE_URL}${UPLOAD_ROOT}`)
            if (existsSync(resolve(targetDir, 'evil.txt')))
                throw "file created"
        }
        finally {
            await rmAny(targetDir)
        }
    })
    test('upload.existing.skip', async () => {
        const filePath = resolve(__dirname, UPLOAD_RELATIVE)
        const before = statSync(filePath).size
        await reqUpload(UPLOAD_DEST + '?existing=skip', 409)()
        const after = statSync(filePath).size
        if (after !== before)
            throw "size changed"
    })
    test('upload.crossing', reqUpload(UPLOAD_DEST.replace(UPLOAD_DIR, '../..'), 404))
    test('upload.overlap', async () => {
        const ms = 300
        const first = reqUpload(UPLOAD_DEST, 200, makeReadableThatTakes(ms))()
        await wait(ms/3)
        await reqUpload(UPLOAD_DEST, 409)() // should conflict
        await first
    })
    test('upload.concurrent', { timeout: 5000 }, () => Promise.all([
        reqUpload(UPLOAD_DEST, 200, new StringRepeaterStream(BIG_CONTENT, 150))(), // 300MB
        ..._.range(3).map(i =>  reqUpload(UPLOAD_DEST + i, 200, new StringRepeaterStream(BIG_CONTENT, 50))()) // 3 x 100MB
    ]).then(() => {}))
    test('upload.interrupted', async () => {
        const fn = resolve(__dirname, UPLOAD_RELATIVE.replace('/', '/hfs$upload-'))
        await rm(fn, {force: true})
        const neededTime = 600
        const makeAbortedRequest = (afterMs: number) => {
            const r = reqUpload(UPLOAD_DEST + '?supposedToAbort' /*to recognize in the logs*/, 0, makeReadableThatTakes(neededTime))()
            setTimeout(r.abort, afterMs)
            return r.catch(() => {}) // wait for it to fail
                .then(() => wait(500)) // aborted requests don't guarantee that the server has finished and released the file, so we wait some arbitrary time
        }
        const timeFirstRequest = neededTime * .5 // not enough to finish
        await makeAbortedRequest(timeFirstRequest)
        const getTempSize = () => try_(() => statSync(fn)?.size)
        const size = getTempSize()
        if (!size) // temp file is left, not empty
            throw "missing temp file"
        await reqUpload(UPLOAD_DEST + '?resume=0!', 412)()
        await makeAbortedRequest(timeFirstRequest * 1.5) // upload more than r1
        if (!(size < getTempSize()!)) // should be increased, as secondary temp file got bigger and replaced primary one
            throw `temp file not enlarged, it was ${size} and now it's ${getTempSize()}`
        await reqUpload(UPLOAD_DEST, 200, makeReadableThatTakes(0))() // quickly complete the upload, and check for final size
        if (getTempSize())
            throw "temp file should be cleared"
        // test resume
        await makeAbortedRequest(timeFirstRequest)
        const partial = getTempSize()
        if (!partial)
            throw "partial file missing"
        await reqUpload(UPLOAD_DEST, 200, Readable.from(BIG_CONTENT.slice(partial)), BIG_CONTENT.length, partial)()
    })
    test('rename.backslash', async () => {
        await reqApi('rename', { uri: UPLOAD_DEST, dest: 'sub\\file' }, process.platform === 'win32' ? 403 : 200)()
        const d = resolve(__dirname, UPLOAD_DIR)
        await rename(resolve(d, 'sub\\file'), resolve(d, basename(UPLOAD_DEST))).catch(() => {})
    })
    const renameTo = 'z'
    test('rename.ok', reqApi('rename', { uri: UPLOAD_DEST, dest: renameTo }, 200))
    test('delete.miss renamed', req(UPLOAD_DEST, 404, { method: 'delete' }))
    test('delete.ok', async () => {
        const fn = resolve(__dirname, dirname(UPLOAD_RELATIVE), renameTo)
        if (!existsSync(fn))
            throw "missing file"
        await req(dirname(UPLOAD_DEST) + '/' + renameTo, 200, { method: 'delete' })()
        if (existsSync(fn))
            throw "not deleted"
    })
    test('reupload', reqUpload(UPLOAD_DEST, 200))
    test('delete.method', req(UPLOAD_DEST, 200, { method: 'DELETE' }))
    test('delete.miss deleted', req(UPLOAD_DEST, 404, { method: 'delete' }))
    test('rename.tricky chars', async () => {
        const dest = trickyChars
        await mkdir(resolve(__dirname, UPLOAD_DIR), { recursive: true })
        const fn = resolve(__dirname, UPLOAD_RELATIVE)
        await writeFile(fn, 'z')
        try {
            await reqApi('rename', { uri: UPLOAD_DEST, dest }, 200)() // dest is not encoded
            await reqApi('rename', { uri: dirname(UPLOAD_DEST) + '/' + pathEncode(dest), dest: basename(UPLOAD_DEST) }, 200)()
        }
        finally { await rm(fn) }
    })
    const declaredSize = BIG_CONTENT.length / 2
    test('upload.too much', reqUpload(UPLOAD_DEST, (x,res)=> {
        if (res.statusCode === 400) return // status 400 is caused by nodejs itself, intercepting the mismatch, but it's probably an unreliable race condition
        if (res.statusCode !== 200) // it happened sometimes that node didn't block (can't replicate). In such case we should get a 200 with a file the size of declaredSize.
            throw `expected 200, got ${res.statusCode}`
        const size = try_(() => statSync(resolve(__dirname, UPLOAD_RELATIVE)).size)
        if (size !== declaredSize)
            throw `expected ${declaredSize}, got ${size}`
    }, BIG_CONTENT, declaredSize))
    test('upload.free space', async () => {
        const res = statfsSync(ROOT)
        const free = res.bavail * res.bsize
        const fakeSize = Math.round(free * 0.51)
        const r1 = reqUpload(`${UPLOAD_ROOT}${UPLOAD_DIR}/free1`, 400, makeReadableThatTakes(1000), fakeSize)()
        setTimeout(r1.abort, 1500)
        await Promise.all([
            r1.catch(() => {}),
            wait(100).then(() => reqUpload(`${UPLOAD_ROOT}${UPLOAD_DIR}/free2`, 507, makeReadableThatTakes(500), fakeSize)())
        ])
    })
    test('max_dl.account', async () => {
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/big`
        await reqUpload(uri, 200, BIG_CONTENT)()
        await testMaxDl(uri, 2, 1)
    })
    test('logout', async () => {
        await reqApi('get_accounts', {}, 200)() // we're admin
        await reqApi('logout', {}, 401)()
        await reqApi('get_accounts', {}, 401)() // no more
    })
    after(() => rmAny(resolve(__dirname, UPLOAD_DIR)))
})

describe('admin', () => {
    test('add folder', async () => {
        const name = 'added'
        try {
            await reqApi('add_vfs', { source: '.', name, can_see: { this: false, children: true } }, 200, { auth })() // add an invisible folder
            await reqList(name, { inList: ['plugins/'] })()
        }
        finally {
            await reqApi('del_vfs', { uris: ['/'+name] }, data => data?.errors?.[0] === 0, { auth })() // remove
        }
    })
    test('del_vfs.bad uris', reqApi('del_vfs', { uris: ['', '/', '//'] }, (res: any) =>
        throwIf(res?.errors.some((x: any) => x === 406) ? '' : res?.errors || 'missing'), { auth }))
    test('plugins.missing', reqApi('set_plugin', { id: 'missing-plugin', enabled: true }, { status: 400, re: /miss/ }, { auth }))
    test('plugins.update.missing', reqApi('update_plugin', { id: 'missing-plugin' }, 404, { auth }))
    test('monitor.connections safe path decode', async () => {
        const body = makeReadableThatTakes(1000)
        const size = body.length
        const rawName = '%2'
        const uploadPromise = reqUpload(`${UPLOAD_ROOT}${pathEncode(rawName)}`, () => true, body, size)()
        try {
            await wait(200)
            const res = await readEventStreamOnce(`${API}get_connections`, { auth })
            await uploadPromise
            if (res.status !== 200)
                throw `unexpected status ${res.status}`
        }
        finally { await rmAny(resolve(__dirname, rawName)) }
    })
    test('plugins.start_stop', async () => {
        const id = 'download-counter'
        await reqApi('stop_plugin', { id }, 200, { auth })()
        await reqApi('start_plugin', { id }, 200, { auth })()
        await reqApi('stop_plugin', { id }, res => {
            if (res?.msg === 'already stopped')
                throw "plugin didn't start"
        }, { auth })()
    })
    test('plugins.download-counter percent name', async () => {
        const id = 'download-counter'
        await reqApi('start_plugin', { id }, 200, { auth })()
        try {
            const before = await getHits()
            await req(FUNNY_NAME_ENCODED, 200)()
            let after = 0
            for (const _x of _.range(10)) {
                await wait(100)
                after = await getHits()
                if (after > before)
                    break
            }
            if (after <= before)
                throw `counter not incremented (before ${before}, after ${after})`
        }
        finally {
            await reqApi('stop_plugin', { id }, 200, { auth })()
        }

        async function getHits() {
            const listRes = await reqList('/', { status: 200 })()
            const entry = _.find(listRes?.list, { n: FUNNY_NAME })
            if (!entry)
                throw "missing entry in list"
            return entry.hits || 0
        }
    })
})

function login(usr: string, pwd=password) {
    return srpClientSequence(usr, pwd, (cmd: string, params: any) =>
        reqApi(cmd, params, (x,res)=> res.statusCode < 400)())
}

function reqUpload(dest: string, tester: Tester, body?: string | Readable, size?: number, resume=0) {
    if (resume)
        dest += (dest.includes('?') ? '&' : '?') + 'resume=' + resume
    size ??= (body as any)?.length ?? statSync(SAMPLE_FILE_PATH).size  // it's ok that Readable.length is undefined
    const status = (tester as any).status || tester
    if (status === 200)
        tester = {
            status,
            cb(data) {
                const fn = ROOT + decodeURI(data.uri).replace(UPLOAD_ROOT, '')
                const stats = try_(() => statSync(fn))
                if (!stats)
                    throw "uploaded file not found: " + fn
                if (size !== stats.size)
                    throw `uploaded file wrong size: ${fn} = ${stats.size.toLocaleString()} expected ${size?.toLocaleString()}`
                return true
            }
        }
    return req(dest, tester, {
        method: 'PUT',
        headers: { connection: 'close', 'content-length': size === undefined ? size : size - resume },
        body: body ?? createReadStream(SAMPLE_FILE_PATH)
    })
}

async function testMaxDl(uri: string, good: number, bad: number) {
    // make good+bad requests, and check results
    await Promise.all(_.range(good + bad).map(i => req(uri + '?' + i, (_data, res) => {
        if (res.statusCode === 429) {
            if (!bad--)
                throw "too many refused"
            return
        }
        if (res.statusCode === 200) {
            if (!good--)
                throw "too many accepted"
            return
        }
        throw "unexpected status " + res.statusCode
    }, { throttle })() )) // slow down to ensure the attempted downloads are all concurrent
}

type TesterFunction = ((data: any, fullResponse: any) => boolean | void) // true or void for ok, false or throw for error
type Tester = number
    | TesterFunction
    | RegExp
    | {
        mime?: string
        status?: number
        re?: RegExp
        inList?: string[]
        outList?: string[]
        permInList?: Record<string, string>
        empty?: true
        length?: number
        cb?: TesterFunction
    }

type ReqOptions = XRequestOptions & { throttle?: number, baseUrl?: string }

const jar = {}

function req(url: string, test:Tester, { baseUrl, throttle, ...requestOptions }: ReqOptions={}) {
    // passing 'path' keeps it as it is, avoiding internal resolving
    let abortable // copy abortable interface to returned promise
    return () => Object.assign(
        (abortable = httpStream((baseUrl || defaultBaseUrl) + url, { path: url, jar, ...requestOptions }))
            .catch(e => {
                if (e.code === 'ECONNREFUSED')
                    throw e
                return e.cause
            })
            .then(process),
        _.pick(abortable, 'abort')
    )

    async function process(res:any) {
        if (!res)
            return console.log('got', { res })
        //console.debug('sent', requestOptions, 'got', res instanceof Error ? String(res) : [res.status])
        if (test && test instanceof RegExp)
            test = { re:test }
        if (typeof test === 'number')
            test = { status: test }
        const stream = throttle ? res.pipe(new ThrottledStream(new ThrottleGroup(throttle))) : res
        const data = await stream2string(stream).catch(() => '')
        const obj = tryJson(data)
        if (typeof test === 'object') {
            let { status, mime, re, inList, outList, length, permInList } = test
            if (inList || outList)
                status ||= 200
            const gotMime = res.headers?.['content-type']
            const gotStatus = res.statusCode
            const gotLength = res.headers?.['content-length']
            const err = mime && !gotMime?.startsWith(mime) && 'expected mime ' + mime + ' got ' + gotMime
                || status && gotStatus !== status && 'expected status ' + status + ' got ' + gotStatus
                || re && !re.test(data) && 'expected content '+String(re)+' got '+(data || '-empty-')
                || inList && !inList.every(x => isInList(obj, x)) && 'expected in list '+inList
                || outList && !outList.every(x => !isInList(obj, x)) && 'expected not in list '+outList
                || permInList && findDefined(permInList, (v, k) => {
                    const got = _.find(obj.list, { n: k })?.p
                    const negate = v[0] === '!'
                    return findDefined(v.slice(negate ? 1 : 0).split(''), char =>
                        got?.includes(char) === negate ? `expected perm ${v} on ${k}, got ${got}` : undefined)
                })
                || test.empty && data && 'expected empty body'
                || length !== undefined && gotLength !== String(length) && "expected content-length " + length + " got " + gotLength
                || test.cb?.(obj ?? data, res) === false && 'error'
                || ''
            if (err)
                throw Error(err)
        }
        if (typeof test === 'function')
            if (test(obj ?? data, res) === false)
                throw "failed test: " + test
        return obj ?? data
    }
}

async function readEventStreamOnce(url: string, { baseUrl, ...requestOptions }: XRequestOptions & { baseUrl?: string }={}) {
    const res = await httpStream((baseUrl || defaultBaseUrl) + url, {
        path: url,
        httpThrow: false,
        headers: { accept: 'text/event-stream', ...requestOptions.headers },
        ...requestOptions,
    })
    const data = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
            res.destroy()
            reject(new Error('event stream timeout'))
        }, 2000)
        res.once('data', chunk => {
            clearTimeout(timer)
            resolve(String(chunk))
            res.destroy()
        })
        res.once('end', () => {
            clearTimeout(timer)
            resolve('')
        })
        res.once('error', err => {
            clearTimeout(timer)
            reject(err)
        })
    })
    return { status: res.statusCode, data }
}

function reqApi(api: string, params: object, test:Tester, options?: ReqOptions) {
    const isGet = api.startsWith('/')
    return req(API+api, test, {
        body: JSON.stringify(params),
        headers: isGet ? undefined : { 'x-hfs-anti-csrf': '1'},
        ...options,
    })
}

function reqList(uri:string, tester:Tester, params?: object, options?: ReqOptions) {
    return reqApi('get_file_list', { uri, ...params }, tester, options)
}

function isInList(res:any, name:string) {
    return Array.isArray(res?.list) && Boolean((res.list as any[]).find(x => x.n===name))
}

function rmAny(path: string) {
    return rm(path, { recursive: true, force: true }).catch(() => {})
}

function throwIf(msg: any) {
    if (msg)
        throw msg
}

async function ensureCantOverwriteDir() {
    const baseDir = resolve(__dirname, 'work', CANT_OVERWRITE_NAME)
    await mkdir(baseDir, { recursive: true })
    return baseDir
}

class StringRepeaterStream extends Readable {
    constructor(private str: string, private n: number, readonly length=n*str.length) {
        super()
    }
    _read() {
        this.push(this.n-- > 0 ? this.str : null)
    }
}

function makeReadableThatTakes(ms: number) {
    return Object.assign(Readable.from(BIG_CONTENT).pipe(new ThrottledStream(new ThrottleGroup(BIG_CONTENT.length / ms))),
        { length: BIG_CONTENT.length })
}

async function curlWithStatus(cmd: string) {
    const out = (await execP(`${cmd} -w "\\nSTATUS:%{http_code}"`)).trimEnd()
    const idx = out.lastIndexOf('\nSTATUS:')
    if (idx < 0)
        throw "missing status in curl output"
    return { status: Number(out.slice(idx + 8)), body: out.slice(0, idx) }
}
