import test, { describe, before, after } from 'node:test';
import { promisify } from 'util'
import { srpClientSequence } from '../src/srp'
import * as srp from 'tssrp6a'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statfsSync, statSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { exec } from 'child_process'
import _ from 'lodash'
import yaml from 'yaml'
import unzipper from 'unzipper'
import { findDefined, pathEncode, randomId, try_, tryJson, UPLOAD_TEMP_HASH, UPLOAD_TEMP_PREFIX, wait, waitFor } from '../src/cross'
import { httpStream, httpWithBody, parseHttpUrl, stream2string, XRequestOptions } from '../src/util-http'
import { ThrottledStream, ThrottleGroup } from '../src/ThrottledStream'
import { mkdir, rm, rename, writeFile, access } from 'fs/promises'
import { Readable } from 'stream'
import { XMLValidator } from 'fast-xml-parser'
import { BASIC_AUTHENTICATE_HEADER } from '../src/cross'
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
// keep generated uploads under the directory reset by test runners
const UPLOAD_DISK_ROOT = resolve(__dirname, 'tmp')
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
const WEBDAV_UA = 'Microsoft-WebDAV-MiniRedir/10.0.22000'
const OFFICE_WEBDAV_UA = 'Microsoft Office Existence Discovery'
const TOKEN_HEADER = 'lock-token'
const WEBDAV_LOCK_BODY = `<?xml version="1.0" encoding="utf-8"?>
<lockinfo xmlns="DAV:">
  <lockscope><exclusive/></lockscope>
  <locktype><write/></locktype>
</lockinfo>`
const WEBDAV_SHARED_LOCK_BODY = `<?xml version="1.0" encoding="utf-8"?>
<lockinfo xmlns="DAV:">
  <lockscope><shared/></lockscope>
  <locktype><write/></locktype>
</lockinfo>`
const WEBDAV_PROPPATCH_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">
  <D:set>
    <D:prop>
      <Z:Win32LastModifiedTime>Mon, 04 May 2026 10:00:00 GMT</Z:Win32LastModifiedTime>
      <Z:Win32FileAttributes>00000020</Z:Win32FileAttributes>
      <D:getlastmodified>Mon, 04 May 2026 10:00:00 GMT</D:getlastmodified>
    </D:prop>
  </D:set>
</D:propertyupdate>`
let defaultBaseUrl = BASE_URL

const execP = (cmd: string) => promisify(exec)(cmd).then(x => x.stdout)
const srp6aNimbusRoutines = new srp.SRPRoutines(new srp.SRPParameters())

describe('basics', () => {
    test('parseHttpUrl.path escapes invalid chars and keeps unresolved segments', () => {
        const parsedPath = parseHttpUrl('https://example.com/a/../репо with space/%2e%2e/file').path
        if (parsedPath !== '/a/../%D1%80%D0%B5%D0%BF%D0%BE%20with%20space/%2e%2e/file')
            throw Error('unexpected path: ' + parsedPath)
    })
    //before(async () => appStarted)
    test('frontend', req('/', /<body>/, { headers: { accept: '*/*' } })) // workaround: 'accept' is necessary when running server-for-test-dev, still don't know why
    test('force slash', req('/f1', 302, { noRedirect: true }))
    test('list', reqList('/f1/', { inList:['f2/', 'page/'] }))
    test('search', reqList('f1', { inList:['f2/'], outList:['page'] }, { search:'2' }))
    test('search root', reqList('/', { inList:['cantListPage/'], outList:['cantListPage/page/'] }, { search:'page' }))
    test('search.fifo order', async () => {
        // deep search queues subdirectory jobs via makeQ; verify results come in FIFO order.
        // tree: root/{d01..d10}/sub/ — with LIFO the sub/ entries reverse relative to parent order (tau≈-1).
        const dir = resolve(__dirname, '_fifo_test')
        const dirCount = 10 // well above dirQ parallelization (3)
        for (let i = 1; i <= dirCount; i++) {
            const name = `d${String(i).padStart(2, '0')}`
            mkdirSync(join(dir, name, 'sub'), { recursive: true })
        }
        try {
            await reqList('/tests/_fifo_test', {
                cb(data: any) {
                    const names: string[] = data.list.map((x: any) => x.n)
                    const parents = names.filter((n: string) => !n.includes('/'))
                    const subs = names.filter((n: string) => n.endsWith('sub/')).map((n: string) => n.split('/')[0])
                    // Kendall's tau: +1 = same order (FIFO), -1 = reversed (LIFO)
                    let concordant = 0, discordant = 0
                    for (let i = 0; i < parents.length; i++)
                        for (let j = i + 1; j < parents.length; j++) {
                            const d = subs.indexOf(parents[i]) - subs.indexOf(parents[j])
                            if (d > 0) discordant++
                            else if (d < 0) concordant++
                        }
                    const tau = (concordant - discordant) / (concordant + discordant)
                    if (tau <= 0)
                        throw `search results not FIFO; tau=${tau.toFixed(2)}, parents: ${parents}, subs: ${subs}`
                }
            }, { search: '*' })()
        }
        finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
    test('download.mime', req('/f1/f2/alfa.txt', { re:/abcd/, mime:'text/plain' }))
    test('download.disposition', req('/f1/f2/alfa.txt', (_data, res) => res.headers['content-disposition'].startsWith('inline; filename=')))
    test('download.disposition quotes', { skip: process.platform === 'win32' }, async () => {
        const name = '"quoted".txt'
        const file = resolve(__dirname, name)
        await writeFile(file, '')
        await req('/tests/' + pathEncode(name), (_data, res) => res.headers['content-disposition'].includes('filename="\\"quoted\\".txt"'))()
            .finally(() => rm(file))
    })
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
    test('traversal.lang', async () => {
        const pathNoExt = 'tmp-secret'
        const fullPath = resolve(__dirname, pathNoExt + '.json')
        await mkdir(dirname(fullPath), { recursive: true })
        try {
            const marker = 'TRAVERSAL_READ'
            await writeFile(fullPath, JSON.stringify({ translate: { 'Not found': marker } })) // translating Not found exposes the read through the fallback 404 page when GUI assets are absent
            await req('/?lang=x/../../' + pathNoExt, data => !String(data).includes(marker), {
                headers: { 'user-agent': 'Mozilla/5.0' },
            })()
        }
        finally { await rmAny(fullPath) }
    })
    test('traversal.overlong-utf8', req('/f1/page/%c0%ae%c0%ae/%c0%ae%c0%ae/README.md', 404))
    test('bad url encoding', req('/f1/%E0%A4%A', 404))
    test('not-found.default page', req('/missing-default-404', /found<\/h1>/))
    test('not-found.custom page overrides default', () =>
        withCustomHtml({ 404: '<strong>custom 404 $MESSAGE</strong>' }, () =>
            req('/missing-custom-404', /^<strong>custom 404 Not found<\/strong>$/)()) )
    test('not-found.default page reverse proxy root', req('/missing-proxy-404', /href="\/prefix/, { headers: { 'x-forwarded-prefix': '/prefix' } }))
    test('custom mime from above', req('/tests/page/index.html', { status: 200, mime:'text/plain' }))
    test('name encoding', req(FUNNY_NAME_ENCODED, 200))
    test('name encoding list', reqList('/', { inList: [FUNNY_NAME] }))
    test('name encoding search', reqList('/', { inList: [FUNNY_NAME] }, { search: FUNNY_NAME }))
    test('basic listing escapes', async () => {
        const name = '<img src=x onerror=alert(1)>.png'
        const path = resolve(__dirname, name)
        await writeFile(path, '')
        try {
            await req('/tests/?get=basic', { status: 200, cb: data => !String(data).includes(name) }, {
                headers: { 'user-agent': 'Mozilla/5.0' },
            })()
        }
        finally {
            await rm(path, { force: true })
        }
    })
    test('folder list preserves encoded colon in prepend', req('/tests/C%3A/?get=list&folders=*', data => {
        if (!String(data).includes('/tests/C%3A/gpl.png'))
            throw Error('missing correctly encoded path in list: ' + data)
        if (String(data).includes('/tests/C%253A/'))
            throw Error('double encoded path in list: ' + data)
    }))
    test('folder list strips base_url root', req('/f1/f2/?get=list&folders=*', data => {
        data = String(data)
        if (!data.includes(`${BASE_URL_127}/f2/alfa.txt`))
            throw Error('missing base_url-rooted path in list: ' + data)
        if (data.includes(`${BASE_URL_127}/f1/f2/alfa.txt`))
            throw Error('base_url root still present in list: ' + data)
    }))
    test('folder list ignores base_url outside its root', req('/tests/?get=list&folders=*', data => {
        data = String(data)
        if (!data.includes(`${BASE_URL}/tests/page/`))
            throw Error('missing request-host path in list: ' + data)
        if (data.includes(BASE_URL_127))
            throw Error('base_url used outside its root: ' + data)
    }))

    test('missing perm', reqList('/for-admins/', 401))
    test('missing perm.file', req('/for-admins/alfa.txt', 401))
    test('missing anti-csrf', reqApi('rename', { uri: '/f1', dest: 'x' }, 418, { headers: {} })) // overriding anti-csrf
    test('missing anti-csrf.get mutation', req(API + 'add_account?username=csrf&password=x&admin=true', 418, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        jar: {},
    }))
    test('malformed body', reqApi('rename', { uri: '/f1', dest: 'x' }, { status: 400 }, {
        headers: { 'x-hfs-anti-csrf': '1', 'content-type': 'application/json' },
        body: '{'
    }))
    test('file_details.missing', reqApi('get_file_details', { uris: ['/missing'] }, noVisibleDetails))
    test('file_details.hidden', reqApi('get_file_details', { uris: ['/tests/config.yaml'] }, noVisibleDetails))
    test('file_details.for-admins', reqApi('get_file_details', { uris: ['/for-admins/alfa.txt'] }, noVisibleDetails))
    test('file_details.traversal', reqApi('get_file_details', { uris: ['/f1/%2e%2e/for-admins/alfa.txt'] }, noVisibleDetails))
    test('file_list.traversal', reqApi('get_file_list', { uri: '/f1/%2e%2e/for-admins' }, 404))
    test('file_list.bad encoding', reqApi('get_file_list', { uri: '/f1/%E0%A4%A' }, 404))
    test('send-list api without SSE', reqApi('get_plugins', {}, data => Array.isArray(data.list), { auth, jar: {} })) // jar because we don't want to authenticate also next tests
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
    test('onlyFiles.deep', reqList('/onlyFilesDeep', { outList: ['top/mid/'] }, { onlyFiles: true, search: 'mid' }))
    test('cantSearchForMasks.deep', reqList('/cantSearchForMasksDeep', { inList: ['gpl-visible.png'], outList: ['page/gpl.png'] }, { search: 'gpl' }))
    test('masks.overlap.basename+path', reqList('/maskOverlap', {
        inList: ['gpl-visible.png'],
        outList: ['page/gpl.png'],
        cb: data => /[rR]/.test(_.find(data?.list, { n: 'gpl-visible.png' })?.p || ''),
    }, { search: 'gpl' }))
    test('mask.onRenamedPath', async () => {
        await reqList('/maskOnRenamedPath', { outList: ['page/renamed-gpl.png'] }, { search: 'renamed-gpl' })()
        await reqList('/maskOnRenamedPath', { outList: ['nested/page/renamed-gpl-nested.png'] }, { search: 'renamed-gpl-nested' })()
    })
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
    test('zip.list.compacted folders', req('/f1/?get=zip&list=page%2Fgpl.png%2F%2F%00index.html', /page\/gpl.png.+page\/index.html/))
    test('zip.list.selected folder decodes prefix', req('/tests/?get=zip&list=C%253A', data =>
        String(data).includes('C:/gpl.png') && !String(data).includes('C%3A/gpl.png')))
    test('zip.list.selected nested folder preserves path', async () => {
        const url = '/?get=zip&list=f1%2Fpage'
        const { body } = await httpWithBody(BASE_URL + url, { path: url })
        const paths = (await unzipper.Open.buffer(body!)).files.map(x => x.path)
        if (!paths.includes('f1/page/') || paths.includes('page/'))
            throw Error('unexpected archive paths: ' + paths)
    })
    test('zip.list.bad encoding', req('/f1/?get=zip&list=%E0%A4%A//%00', { status: 200, length: 22 })) // basically empty
    test('zip.list.null filename', req('/f1/?get=zip&list=%00', 400)) // tries to name the output with null-byte
    test('zip.masked deep', req('/cantSearchForMasksDeep/?get=zip', {
        status: 200,
        cb: data => !data.includes('page/gpl.png') && data.includes('gpl-visible.png'),
    }))
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
        const fn = uploadUriToPath(uri)
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
    test('upload.post.missing-boundary', async () => {
        const { status } = await curlWithStatus(`printf 'x' | curl -s -u ${auth} -H "Content-Type: multipart/form-data" --data-binary @- ${BASE_URL}${UPLOAD_ROOT}`)
        if (status !== 400)
            throw "unexpected status " + status
    })
    test('upload.post.truncated', async () => {
        const boundary = '----hfs-boundary'
        const body = `--${boundary}\\r\\nContent-Disposition: form-data; name="upload"\\r\\n`
        const { status } = await curlWithStatus(`printf '%b' '${body}' | curl -s -u ${auth} -H "Content-Type: multipart/form-data; boundary=${boundary}" --data-binary @- ${BASE_URL}${UPLOAD_ROOT}`)
        if (status !== 400)
            throw "unexpected status " + status
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

describe('webdav', () => {
    const jar = {}
    after(() => rmAny(resolve(UPLOAD_DISK_ROOT, UPLOAD_DIR)))
    test('webdav force login.scope propfind', req('/f1/', 401, { method: 'PROPFIND', headers: { depth: '0' }, jar }))
    test('webdav force login.scope options', req('/f1/', (_data, res) =>
        res.statusCode === 401 && res.headers?.['www-authenticate'] === BASIC_AUTHENTICATE_HEADER, {
        method: 'OPTIONS',
        headers: { 'user-agent': OFFICE_WEBDAV_UA },
        jar: {},
    }))
    test('webdav force login.scope get', req('/f1/protected', (_data, res) =>
        res.statusCode === 401 && res.headers?.['www-authenticate'] === BASIC_AUTHENTICATE_HEADER, {
        headers: { 'user-agent': OFFICE_WEBDAV_UA },
        jar: {},
    }))
    test('webdav.get keeps webdav challenge after denied read', async () => {
        const user = `wd-read-${randomId(6)}`.toLowerCase()
        const pass = `pw-${randomId(8)}`
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: user, overwrite: true, password: pass }, res => res?.username === user, adminReq)()
            await req('/f1/protected', (_data, res) =>
                res.statusCode === 401 && res.headers?.['www-authenticate'] === BASIC_AUTHENTICATE_HEADER, {
                auth: `${user}:${pass}`,
                headers: { 'user-agent': OFFICE_WEBDAV_UA },
                jar: {},
            })()
        }
        finally {
            await reqApi('del_account', { username: user }, 200, adminReq)().catch(() => {})
        }
    })
    test('webdav options works after auth', req('/f1/', (_data, res) =>
        res.statusCode === 200 && res.headers?.dav === '1,2', {
        method: 'OPTIONS',
        auth,
        headers: { 'user-agent': OFFICE_WEBDAV_UA },
        jar: {},
    }))
    test('webdav.put detects client after propfind', async () => {
        const name = `wd-detected-${randomId(6)}.txt`
        const ua = `hfs-test-detected-${randomId(6)}`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'dest', ua)()
            await req(uri, 207, { method: 'PROPFIND', auth, jar, headers: { depth: '0', 'user-agent': ua } })()
            const secondPath = await webdavUpload(uri, x => x?.uri === uri, 'source', ua)()
            if (secondPath !== destPath)
                throw "destination changed unexpectedly"
            if (readFileSync(destPath, 'utf8') !== 'source')
                throw "destination wasn't overwritten"
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.put default-overwrite with can_delete', async () => {
        const name = `wd-overwrite-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'dest')()
            const secondPath = await webdavUpload(uri, x => x?.uri === uri, 'source')()
            if (secondPath !== destPath)
                throw "destination changed unexpectedly"
            if (readFileSync(destPath, 'utf8') !== 'source')
                throw "destination wasn't overwritten"
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.put overwrite forbidden without can_delete', async () => {
        const name = `wd-nodelete-${randomId(6)}.txt`
        const uri = `${CANT_OVERWRITE_URI}${name}`
        const dir = await ensureCantOverwriteDir()
        const destPath = resolve(dir, name)
        await writeFile(destPath, 'dest')
        try {
            await webdavUpload(uri, 403, 'source')()
            if (readFileSync(destPath, 'utf8') !== 'dest')
                throw "destination changed"
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.put failed overwrite does not grant grace', async () => {
        const name = `wd-failed-grace-${randomId(6)}.txt`
        const uri = `${CANT_OVERWRITE_URI}${name}`
        const dir = await ensureCantOverwriteDir()
        const destPath = resolve(dir, name)
        await writeFile(destPath, 'dest')
        try {
            await req(uri, 403, {
                method: 'PUT',
                auth,
                jar,
                headers: { 'content-length': '0', 'user-agent': WEBDAV_UA },
                body: '',
            })()
            await webdavUpload(uri, 403, 'source')()
            if (readFileSync(destPath, 'utf8') !== 'dest')
                throw "destination changed"
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.put grants grace after successful encoded empty upload', async () => {
        const name = `wd-grace-${randomId(6)} %#.txt`
        const uri = `${CANT_OVERWRITE_URI}${pathEncode(name)}`
        const dir = await ensureCantOverwriteDir()
        const destPath = resolve(dir, name)
        try {
            await req(uri, (x, res) => {
                if (res.statusCode !== 200)
                    throw `expected first PUT 200, got ${res.statusCode}`
                if (x?.uri !== uri)
                    throw "first PUT uri mismatch"
            }, {
                method: 'PUT',
                auth,
                jar,
                headers: { 'content-length': '0', 'user-agent': WEBDAV_UA },
                body: '',
            })()
            await req(uri, (x, res) => {
                if (res.statusCode !== 200)
                    throw `expected second PUT 200, got ${res.statusCode}`
                if (x?.uri !== uri)
                    throw "second PUT uri mismatch"
            }, {
                method: 'PUT',
                auth,
                jar,
                headers: { 'x-expected-entity-length': String(Buffer.byteLength('source')), 'user-agent': WEBDAV_UA },
                body: 'source',
            })()
            if (readFileSync(destPath, 'utf8') !== 'source')
                throw "destination not overwritten"
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.put grace is bound to username', async () => {
        const firstUser = `wd-grace-a-${randomId(6)}`.toLowerCase()
        const secondUser = `wd-grace-b-${randomId(6)}`.toLowerCase()
        const firstPass = `pw-${randomId(8)}`
        const secondPass = `pw-${randomId(8)}`
        const name = `wd-grace-${randomId(6)}.txt`
        const uri = `${CANT_OVERWRITE_URI}${name}`
        const dir = await ensureCantOverwriteDir()
        const destPath = resolve(dir, name)
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: firstUser, overwrite: true, password: firstPass, belongs: ['admins'] }, res => res?.username === firstUser, adminReq)()
            await reqApi('add_account', { username: secondUser, overwrite: true, password: secondPass, belongs: ['admins'] }, res => res?.username === secondUser, adminReq)()
            await rmAny(destPath)
            await req(uri, x => x?.uri === uri, {
                method: 'PUT',
                auth: `${firstUser}:${firstPass}`,
                jar: {},
                headers: { 'content-length': '0', 'user-agent': WEBDAV_UA, },
                body: '',
            })()
            if (!existsSync(destPath))
                throw "first upload did not create the file"
            await req(uri, 403, {
                method: 'PUT',
                auth: `${secondUser}:${secondPass}`,
                jar: {},
                headers: { 'content-length': String(Buffer.byteLength('source')), 'user-agent': WEBDAV_UA },
                body: 'source',
            })()
            if (readFileSync(destPath, 'utf8') !== '')
                throw "second upload unexpectedly overwrote destination"
        }
        finally {
            await reqApi('del_account', { username: [firstUser, secondUser] }, 200, adminReq)().catch(() => {})
            await rmAny(destPath)
        }
    })
    test('webdav.lock requires write permission', async () => {
        const user = `wd-lock-readonly-${randomId(6)}`.toLowerCase()
        const password = randomId(10)
        const uri = '/tests/page/gpl.png'
        let token = ''
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: user, password }, res => res?.username === user, adminReq)()
            await req(uri, 401, {
                method: 'LOCK',
                auth: `${user}:${password}`,
                jar: {},
                headers: { 'content-type': 'text/xml', 'user-agent': WEBDAV_UA },
                body: WEBDAV_LOCK_BODY,
            })()
            await webdavLock(uri, (_data, res) => token = res.headers?.[TOKEN_HEADER] || '')()
        }
        finally {
            if (token)
                await webdavUnlock(uri, token)().catch(() => {})
            await reqApi('del_account', { username: user }, 200, adminReq)().catch(() => {})
        }
    })
    test('webdav.lock allows a missing upload destination', async () => {
        const uri = `${UPLOAD_ROOT}wd-lock-missing-${randomId(6)}.txt`
        let token = ''
        try {
            await webdavLock(uri, (_data, res) => token = res.headers?.[TOKEN_HEADER] || '')()
            if (!token)
                throw "missing lock token"
        }
        finally {
            if (token)
                await webdavUnlock(uri, token)().catch(() => {})
        }
    })
    test('webdav.lock refresh keeps token', async () => {
        const name = `wd-lock-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        let token = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await webdavLock(uri, (_data, res) => token = res.headers?.[TOKEN_HEADER] || '')()
            if (!token)
                throw "missing lock token"
            await webdavLock(uri, (_data, res) =>
                res.statusCode === 200 && res.headers?.[TOKEN_HEADER] === token, '', { If: `(<${token}>)` })()
        }
        finally {
            if (token)
                await webdavUnlock(uri, token)().catch(() => {})
            await rmAny(destPath)
        }
    })
    test('webdav.lock rejects shared lock', async () => {
        const name = `wd-lock-shared-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await webdavLock(uri, 409, WEBDAV_SHARED_LOCK_BODY)()
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.stale lock on missing resource is pruned', async () => {
        const name = `wd-stale-lock-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await webdavLock(uri)()
            // simulate external removal while client forgot to unlock: stale lock must not force 423 forever
            await rmAny(destPath)
            await req(uri, 404, { method: 'DELETE', auth, jar, headers: { 'user-agent': WEBDAV_UA } })()
            await req(uri, 404, { method: 'DELETE', auth, jar, headers: { 'user-agent': WEBDAV_UA } })()
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.delete success clears lock for same path', async () => {
        const name = `wd-delete-clears-lock-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        let token = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await webdavLock(uri, (_data, res) => token = res.headers?.[TOKEN_HEADER] || '')()
            if (!token)
                throw "missing lock token"
            await req(uri, 200, { method: 'DELETE', auth, jar, headers: { If: `(<${token}>)`, 'user-agent': WEBDAV_UA } })()
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test2')()
            await req(uri, 200, { method: 'DELETE', auth, jar, headers: { 'user-agent': WEBDAV_UA } })()
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.move success clears lock state', async () => {
        const name = `wd-move-clears-lock-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        const renamedName = name.replace('.txt', '-renamed.txt')
        const renamed = `${UPLOAD_ROOT}${UPLOAD_DIR}/${renamedName}`
        let destPath = ''
        let renamedPath = ''
        let token = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await webdavLock(uri, (_data, res) => token = res.headers?.[TOKEN_HEADER] || '')()
            if (!token)
                throw "missing lock token"
            await req(uri, 201, {
                method: 'MOVE',
                auth,
                jar,
                headers: {
                    destination: BASE_URL + renamed,
                    overwrite: 'F',
                    If: `(<${token}>)`,
                    'user-agent': WEBDAV_UA,
                },
            })()
            renamedPath = uploadUriToPath(renamed)
            await req(renamed, 200, { method: 'DELETE', auth, jar, headers: { 'user-agent': WEBDAV_UA } })()
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test2')()
            await req(uri, 200, { method: 'DELETE', auth, jar, headers: { 'user-agent': WEBDAV_UA } })()
        }
        finally {
            await rmAny(renamedPath)
            await rmAny(destPath)
        }
    })
    test('webdav.move rename decodes escaped segment chars', async () => {
        for (const marker of [',', '#', '%']) {
            const name = `wd-move-${randomId(6)}.txt`
            const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
            const renamedName = name.replace('.txt', `${marker}renamed.txt`)
            const renamed = `${UPLOAD_ROOT}${UPLOAD_DIR}/${pathEncode(renamedName)}`
            const destination = `${UPLOAD_ROOT}${UPLOAD_DIR}/${encodeURIComponent(renamedName)}`
            let destPath = ''
            try {
                destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
                await req(uri, 201, {
                    method: 'MOVE',
                    auth,
                    jar,
                    headers: {
                        destination: BASE_URL + destination,
                        overwrite: 'F',
                        'user-agent': WEBDAV_UA,
                    },
                })()
                await req(uri, 404)()
                await req(renamed, 200, { auth })()
            }
            finally {
                await rmAny(uploadUriToPath(uri))
                await rmAny(uploadUriToPath(renamed))
                await rmAny(destPath)
            }
        }
    })
    test('webdav.move rename cannot traverse out of root', async () => {
        const name = `wd-move-trav-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        const escapedName = `wd-escaped-${randomId(6)}.txt`
        const traversal = `../../${escapedName}` // climbs above the upload node's source
        // encode as a single path segment so dirname(dest) still matches dirname(path) and we hit the rename branch
        const destination = `${BASE_URL}${UPLOAD_ROOT}${UPLOAD_DIR}/${encodeURIComponent(traversal)}`
        const escapedDiskPath = resolve(UPLOAD_DISK_ROOT, UPLOAD_DIR, traversal)
        let destPath = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await req(uri, 400, { method: 'MOVE', auth, jar, headers: { destination, overwrite: 'F', 'user-agent': WEBDAV_UA } })()
            if (await access(escapedDiskPath).then(() => true, () => false))
                throw "file escaped the VFS root"
            await req(uri, 200, { auth })() // source must still be there, untouched
        }
        finally {
            await rmAny(escapedDiskPath)
            await rmAny(destPath)
        }
    })
    test('webdav.proppatch accepts dead properties as no-op', async () => {
        const name = `wd-proppatch-${randomId(6)}.txt`
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/${name}`
        let destPath = ''
        try {
            destPath = await webdavUpload(uri, x => x?.uri === uri, 'test')()
            await req(uri, data => data.includes(`<href>${uri}</href>`) && !data.includes(`<href>${uri}/</href>`), {
                method: 'PROPFIND',
                auth,
                jar,
                headers: { depth: '0', 'user-agent': WEBDAV_UA },
            })()
            await req(uri, (data, res) => {
                if (res.statusCode !== 207)
                    throw `expected 207, got ${res.statusCode}`
                if (XMLValidator.validate(data) !== true)
                    throw "invalid XML"
                if (!/<Win32LastModifiedTime\/>[\s\S]*HTTP\/1\.1 200 OK/.test(data))
                    throw "missing no-op success for Windows property"
                if (!/<getlastmodified\/>[\s\S]*HTTP\/1\.1 403 Forbidden/.test(data))
                    throw "missing forbidden status for protected live property"
            }, {
                method: 'PROPPATCH',
                auth,
                jar,
                headers: {
                    'content-type': 'text/xml',
                    'content-length': Buffer.byteLength(WEBDAV_PROPPATCH_BODY),
                    'user-agent': WEBDAV_UA,
                },
                body: WEBDAV_PROPPATCH_BODY,
            })()
            if (Math.abs(statSync(destPath).mtimeMs - Date.parse('Mon, 04 May 2026 10:00:00 GMT')) > 1000)
                throw "mtime was not updated"
        }
        finally {
            await rmAny(destPath)
        }
    })
    test('webdav.proppatch requires upload permission for timestamp changes', req('/f1/f2/alfa.txt', data =>
        /<Win32LastModifiedTime\/>[\s\S]*HTTP\/1\.1 403 Forbidden/.test(data), {
        method: 'PROPPATCH',
        auth,
        jar,
        headers: {
            'content-type': 'text/xml',
            'content-length': Buffer.byteLength(WEBDAV_PROPPATCH_BODY),
            'user-agent': WEBDAV_UA,
        },
        body: WEBDAV_PROPPATCH_BODY,
    }))
    test('webdav.proppatch metadata grace is bound to recent upload', async () => {
        const staleName = `wd-proppatch-stale-${randomId(6)}.txt`
        const freshName = `wd-proppatch-fresh-${randomId(6)}.txt`
        const staleUri = `${CANT_OVERWRITE_URI}${staleName}`
        const freshUri = `${CANT_OVERWRITE_URI}${freshName}`
        const dir = await ensureCantOverwriteDir()
        const stalePath = resolve(dir, staleName)
        let freshPath = ''
        try {
            await writeFile(stalePath, 'stale')
            await req(staleUri, data => /<Win32LastModifiedTime\/>[\s\S]*HTTP\/1\.1 403 Forbidden/.test(data), {
                method: 'PROPPATCH',
                auth,
                jar,
                headers: {
                    'content-type': 'text/xml',
                    'content-length': Buffer.byteLength(WEBDAV_PROPPATCH_BODY),
                    'user-agent': WEBDAV_UA,
                },
                body: WEBDAV_PROPPATCH_BODY,
            })()
            freshPath = await webdavUpload(freshUri, x => x?.uri === freshUri, 'fresh')()
            await req(freshUri, data => /<Win32LastModifiedTime\/>[\s\S]*HTTP\/1\.1 200 OK/.test(data), {
                method: 'PROPPATCH',
                auth,
                jar,
                headers: {
                    'content-type': 'text/xml',
                    'content-length': Buffer.byteLength(WEBDAV_PROPPATCH_BODY),
                    'user-agent': WEBDAV_UA,
                },
                body: WEBDAV_PROPPATCH_BODY,
            })()
        }
        finally {
            await rmAny(stalePath)
            await rmAny(freshPath)
        }
    })
    test('webdav.escaping', req('/f1/hidden', data => XMLValidator.validate(data) === true, { method: 'PROPFIND', auth, jar: {}, headers: { depth: '1' } }))

    function webdavUpload(uri: string, tester: Tester, body: string, userAgent=WEBDAV_UA) {
        return () => req(uri, tester, {
            method: 'PUT',
            auth,
            jar,
            headers: {
                'content-length': Buffer.byteLength(body),
                'user-agent': userAgent,
            },
            body,
        })().then(res => uploadUriToPath(res?.uri || uri))
    }

    function webdavLock(uri: string, tester: Tester=200, body=WEBDAV_LOCK_BODY, headers?: Record<string, string>) {
        return req(uri, tester, {
            method: 'LOCK',
            auth,
            jar,
            headers: {
                'content-type': 'text/xml',
                'content-length': Buffer.byteLength(body),
                'user-agent': WEBDAV_UA,
                ...headers,
            },
            body,
        })
    }

    function webdavUnlock(uri: string, token: string, tester: Tester=204) {
        return req(uri, tester, {
            method: 'UNLOCK',
            auth,
            jar,
            headers: {
                'user-agent': WEBDAV_UA,
                [TOKEN_HEADER]: `<${token}>`,
            },
        })
    }

})

// do this before login, or max_dl.accounts config will override max_dl
describe('limits', () => {
    const fn = ROOT + 'big'
    before(() => writeFile(fn, BIG_CONTENT))
    test('max_dl', () => testMaxDl('/' + fn, 1, 2, { jar: {} }))
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
    test('allow_net cache follows account switch', async () => {
        const u = `allow-net-switch-${randomId(6)}`.toLowerCase()
        const p = `pw-${randomId(8)}`
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: u, password: p, allow_net: '192.0.2.1' },
                res => res?.username === u, adminReq)()
            const jar = {}
            // cache the current account mask before presenting credentials for another account
            await reqApi('refresh_session', {}, res => res?.username === username, { auth, jar })()
            await reqApi('refresh_session', {}, res => res?.username === username, { jar })()
            await reqApi('refresh_session', {}, res => {
                if (res?.username)
                    throw Error(`account switch bypassed allow_net as ${res.username}`)
            }, { auth: `${u}:${p}`, jar })()
        }
        finally {
            await reqApi('del_account', { username: u }, 200, adminReq)().catch(() => {})
        }
    })
    test('auto_login_net.canLogin', async () => {
        const user = `auto-login-${randomId(6)}`.toLowerCase()
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: user, overwrite: true, auto_login_net: '::1' }, res => res?.username === user, adminReq)()
            await reqApi('refresh_session', {}, res => res?.username === user, { jar: {} })()
            await reqApi('refresh_session', {}, res => !res?.username, { baseUrl: BASE_URL_127, jar: {} })()
        }
        finally {
            await reqApi('del_account', { username: user }, 200, adminReq)().catch(() => {})
        }
    })
    test('change_srp enforces self/admin permissions', async () => {
        const selfUser = `change-srp-self-${randomId(6)}`.toLowerCase()
        const otherUser = `change-srp-other-${randomId(6)}`.toLowerCase()
        const selfPwd = `pw-${randomId(8)}`
        const adminReq = { auth, jar: {} }
        try {
            await reqApi('add_account', { username: selfUser, overwrite: true, password: selfPwd }, res => res?.username === selfUser, adminReq)()
            await reqApi('add_account', { username: otherUser, overwrite: true, password: randomId(8) }, res => res?.username === otherUser, adminReq)()

            const selfChange = await makeSrpChange(selfUser)
            const jar = {}
            await reqApi('change_srp', selfChange, 401, { jar })() // no account
            await reqApi('refresh_session', {}, res => res?.username === selfUser, { jar, auth: `${selfUser}:${selfPwd}` })()
            await reqApi('change_srp', selfChange, 200, { jar })() // my account
            const otherChange = await makeSrpChange(otherUser)
            await reqApi('change_srp', otherChange, 401, { jar })() // another account but no admin
            await reqApi('change_srp', otherChange, 200, adminReq)() // another account and i'm admin
        }
        finally {
            await reqApi('del_account', { username: [selfUser, otherUser] }, 200, adminReq)().catch(() => {})
        }

        async function makeSrpChange(username: string, password=`next-${randomId(8)}`) {
            const res = await srp.createVerifierAndSalt(srp6aNimbusRoutines, username, password)
            return { salt: String(res.s), verifier: String(res.v), username }
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
    test('create_folder.empty name', reqApi('create_folder', { uri: UPLOAD_ROOT, name: '' }, 400))
    test('create_folder.tricky chars', async () => {
        await reqApi('create_folder', { uri: UPLOAD_ROOT, name: trickyChars }, 200)()
        const dest = resolve(UPLOAD_DISK_ROOT, trickyChars)
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
    test('upload.numbered', async () => {
        const uri = `${UPLOAD_ROOT}${UPLOAD_DIR}/put-plain-${randomId(6)}.txt`
        const res: any = {}
        try {
            res.first = await reqUpload(uri, x => x?.uri === uri, 'some')()
            res.second = await reqUpload(uri, x => x?.uri !== uri, 'more')() // this will be numbered to not overwrite
        }
        finally {
            await rmAny(uploadUriToPath(res.first?.uri))
            await rmAny(uploadUriToPath(res.second?.uri))
        }
    })
    test('file_details.admin', reqApi('get_file_details', { uris: [UPLOAD_DEST] }, res => {
        const u = res?.details?.[0]?.upload
        throwIf(!u?.ip ? 'ip' : u?.username !== username ? 'username' : '')
    }))
    test('file_details.non-admin', reqApi('get_file_details', { uris: [UPLOAD_DEST] }, noVisibleDetails, { jar: {} }))
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
            await rmAny(resolve(UPLOAD_DISK_ROOT, percentName))
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
            await rmAny(resolve(UPLOAD_DISK_ROOT, renameName))
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
            await rmAny(resolve(UPLOAD_DISK_ROOT, percentName))
            await rmAny(resolve(UPLOAD_DISK_ROOT, folderName, percentName))
            await rmAny(resolve(UPLOAD_DISK_ROOT, folderName))
        }
    })
    test('zip.no-list but archive', req('/zipNoList/?get=zip', 403, { jar: {} }))
    test('upload but not delete', async () => {
        const name = `cant-delete`
        await mkdir(resolve(UPLOAD_DISK_ROOT, name), { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: ['admins'], can_delete: false }, 200)()
        await reqApi('set_config', { values: { own_upload_delete_hours: 0 } }, 200)()
        try {
            const dest = `${UPLOAD_ROOT}${name}/no-delete.txt`
            await reqUpload(dest, 200)()
            await req(dest, 403, { method: 'delete' })()
        }
        finally {
            await reqApi('set_config', { values: { own_upload_delete_hours: 24 } }, 200)().catch(() => {})
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(resolve(UPLOAD_DISK_ROOT, name))
        }
    })
    test('upload owner can delete without delete permission', async () => {
        const name = `owner-delete-${randomId(6)}`
        const otherUser = `owner-other-${randomId(6)}`.toLowerCase()
        const otherPass = `pw-${randomId(8)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const dest = `${UPLOAD_ROOT}${name}/owned.txt`
        const adminReq = { auth, jar: {} }
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: ['admins'], can_delete: false }, 200)()
        try {
            await reqApi('add_account', { username: otherUser, overwrite: true, password: otherPass, belongs: ['admins'] }, res => res?.username === otherUser, adminReq)()
            await reqUpload(dest, 200)()
            await req(dest, 403, { method: 'delete', auth: `${otherUser}:${otherPass}`, jar: {} })()
            await req(dest, 200, { method: 'delete' })()
        }
        finally {
            await reqApi('del_account', { username: otherUser }, 200, adminReq)().catch(() => {})
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('upload owner follows rename and move', async () => {
        const name = `owner-move-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const start = `${UPLOAD_ROOT}${name}/start.txt`
        const renamed = `${UPLOAD_ROOT}${name}/renamed.txt`
        const folder = `${UPLOAD_ROOT}${name}/folder/`
        const moved = `${folder}renamed.txt`
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: ['admins'], can_delete: false }, 200)()
        try {
            await reqUpload(start, 200)()
            await reqApi('rename', { uri: start, dest: 'renamed.txt' }, 200)()
            await reqApi('create_folder', { uri: `${UPLOAD_ROOT}${name}/`, name: 'folder' }, 200)()
            await reqApi('move_files', { uri_from: [renamed], uri_to: folder }, res => !res?.errors?.[0])()
            await req(moved, 200, { method: 'delete' })()
        }
        finally {
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('upload owner is bound to session', async () => {
        const name = `session-owner-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const sameJar = {}
        const otherJar = {}
        const first = `${UPLOAD_ROOT}${name}/same-session.txt`
        const second = `${UPLOAD_ROOT}${name}/other-session.txt`
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: true, can_delete: false }, 200)()
        try {
            await reqUpload(first, 200, undefined, undefined, 0, { jar: sameJar })()
            await req(first, 200, { method: 'delete', jar: sameJar })()
            await reqUpload(second, 200, undefined, undefined, 0, { jar: sameJar })()
            await req(second, 403, { method: 'delete', jar: otherJar })()
            await req(second, 200, { method: 'delete', jar: sameJar })()
        }
        finally {
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('upload owner session survives login', async () => {
        const name = `session-login-owner-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const anonJar = {}
        const user = `anon-login-${randomId(6)}`.toLowerCase()
        const pass = `pw-${randomId(8)}`
        const dest = `${UPLOAD_ROOT}${name}/before-login.txt`
        const adminReq = { auth, jar: {} }
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: true, can_delete: false }, 200)()
        try {
            await reqApi('add_account', { username: user, overwrite: true, password: pass }, res => res?.username === user, adminReq)()
            await reqUpload(dest, 200, undefined, undefined, 0, { jar: anonJar })()
            await reqApi('refresh_session', {}, res => res?.username === user, { jar: anonJar, auth: `${user}:${pass}` })()
            await req(dest, 200, { method: 'delete', jar: anonJar })()
        }
        finally {
            await reqApi('del_account', { username: user }, 200, adminReq)().catch(() => {})
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('upload owner session is cleared by logout', async () => {
        const name = `session-logout-owner-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const anonJar = {}
        const user = `session-logout-${randomId(6)}`.toLowerCase()
        const pass = `pw-${randomId(8)}`
        const dest = `${UPLOAD_ROOT}${name}/before-logout.txt`
        const adminReq = { auth, jar: {} }
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: true, can_delete: false }, 200)()
        try {
            await reqApi('add_account', { username: user, overwrite: true, password: pass }, res => res?.username === user, adminReq)()
            await reqUpload(dest, 200, undefined, undefined, 0, { jar: anonJar })()
            await reqApi('refresh_session', {}, res => res?.username === user, { jar: anonJar, auth: `${user}:${pass}` })()
            await reqApi('logout', {}, 401, { jar: anonJar })()
            await req(dest, 403, { method: 'delete', jar: anonJar })()
        }
        finally {
            await reqApi('del_account', { username: user }, 200, adminReq)().catch(() => {})
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('upload owner delete window expires', async () => {
        const name = `owner-expire-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const dest = `${UPLOAD_ROOT}${name}/expired.txt`
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: ['admins'], can_delete: false }, 200)()
        await reqApi('set_config', { values: { own_upload_delete_hours: 0.00001 } }, 200)()
        try {
            await reqUpload(dest, 200)()
            await wait(60)
            await req(dest, 403, { method: 'delete' })()
        }
        finally {
            await reqApi('set_config', { values: { own_upload_delete_hours: 24 } }, 200)().catch(() => {})
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
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
            await rmAny(resolve(UPLOAD_DISK_ROOT, UPLOAD_DIR, destFile))
            await rmAny(destDir)
        }
    })
    test('upload.path bypass', async () => {
        const name = 'no-upload'
        const targetDir = resolve(UPLOAD_DISK_ROOT, name)
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
        const filePath = resolve(UPLOAD_DISK_ROOT, UPLOAD_RELATIVE)
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
        const fn = resolve(UPLOAD_DISK_ROOT, UPLOAD_RELATIVE.replace('/', '/' + UPLOAD_TEMP_PREFIX))
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
    test('upload.interrupted cleanup requires owner or delete permission', async () => {
        const name = `unfinished-cleanup-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const dest = `${UPLOAD_ROOT}${name}/unfinished.txt`
        const tempName = UPLOAD_TEMP_PREFIX + 'unfinished.txt'
        const temp = resolve(dir, tempName)
        const tempUri = `${UPLOAD_ROOT}${name}/${pathEncode(tempName)}`
        // use a dedicated session because other suites may change the shared test jar
        const ownerReq = { auth, jar: {} }
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: ['admins'], can_delete: false }, 200, ownerReq)()
        try {
            await makeAbortedUpload()
            await req(tempUri, 403, { method: 'delete', jar: {} })()
            if (!existsSync(temp))
                throw "temp file removed without permission"
            await req(tempUri, 200, { method: 'delete', ...ownerReq })()
            if (existsSync(temp))
                throw "temp file not removed"
        }
        finally {
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200, ownerReq)().catch(() => {})
            await rmAny(dir)
        }

        async function makeAbortedUpload() {
            await rmAny(temp)
            const r = reqUpload(dest, 0, makeReadableThatTakes(600), undefined, 0, ownerReq)()
            setTimeout(r.abort, 300)
            await r.catch(() => {})
            if (!existsSync(temp))
                throw "missing temp file"
        }
    })
    test('anonymous upload can delete own unfinished upload', async () => {
        const name = `anon-unfinished-cleanup-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const jar = {}
        const dest = `${UPLOAD_ROOT}${name}/unfinished.txt`
        const tempName = UPLOAD_TEMP_PREFIX + 'unfinished.txt'
        const temp = resolve(dir, tempName)
        const tempUri = `${UPLOAD_ROOT}${name}/${pathEncode(tempName)}`
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: true, can_delete: false }, 200)()
        try {
            await reqApi('refresh_session', {}, 200, { jar })()
            const r = reqUpload(dest, 0, makeReadableThatTakes(600), undefined, 0, { jar })()
            setTimeout(r.abort, 300)
            await r.catch(() => {})
            if (!existsSync(temp))
                throw "missing temp file"
            await req(tempUri, 200, { method: 'delete', jar })()
        }
        finally {
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('upload.interrupted owner is cleared after resume completes', async () => {
        const name = `unfinished-resume-cleanup-${randomId(6)}`
        const dir = resolve(UPLOAD_DISK_ROOT, name)
        const dest = `${UPLOAD_ROOT}${name}/unfinished.txt`
        const tempName = UPLOAD_TEMP_PREFIX + 'unfinished.txt'
        const temp = resolve(dir, tempName)
        const tempUri = `${UPLOAD_ROOT}${name}/${pathEncode(tempName)}`
        // use a dedicated session because other suites may change the shared test jar
        const ownerReq = { auth, jar: {} }
        await mkdir(dir, { recursive: true })
        await reqApi('add_vfs', { parent: UPLOAD_ROOT, source: `../tmp/${name}`, name, can_upload: ['admins'], can_delete: false }, 200, ownerReq)()
        try {
            const r = reqUpload(dest, 0, makeReadableThatTakes(600), undefined, 0, ownerReq)()
            setTimeout(r.abort, 300)
            await r.catch(() => {})
            await wait(500)
            const partial = statSync(temp).size
            await reqUpload(dest, 200, Readable.from(BIG_CONTENT.slice(partial)), BIG_CONTENT.length, partial, ownerReq)()
            await writeFile(temp, 'new temp')
            await req(tempUri, 403, { method: 'delete', ...ownerReq })()
        }
        finally {
            await req(dest, 200, { method: 'delete', ...ownerReq })().catch(() => {})
            await reqApi('del_vfs', { uris: [UPLOAD_ROOT + name] }, 200, ownerReq)().catch(() => {})
            await rmAny(dir)
        }
    })
    test('rename.backslash', async () => {
        await reqApi('rename', { uri: UPLOAD_DEST, dest: 'sub\\file' }, process.platform === 'win32' ? 403 : 200)()
        const d = resolve(UPLOAD_DISK_ROOT, UPLOAD_DIR)
        await rename(resolve(d, 'sub\\file'), resolve(d, basename(UPLOAD_DEST))).catch(() => {})
    })
    const renameTo = 'z'
    test('rename.ok', reqApi('rename', { uri: UPLOAD_DEST, dest: renameTo }, 200))
    test('delete.miss renamed', req(UPLOAD_DEST, 404, { method: 'delete' }))
    test('delete.ok', async () => {
        const fn = resolve(UPLOAD_DISK_ROOT, dirname(UPLOAD_RELATIVE), renameTo)
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
        await mkdir(resolve(UPLOAD_DISK_ROOT, UPLOAD_DIR), { recursive: true })
        const fn = resolve(UPLOAD_DISK_ROOT, UPLOAD_RELATIVE)
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
        const size = try_(() => statSync(resolve(UPLOAD_DISK_ROOT, UPLOAD_RELATIVE)).size)
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
    after(() => rmAny(resolve(UPLOAD_DISK_ROOT, UPLOAD_DIR)))
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
    test('add_vfs source without name', async () => {
        const res = await reqApi('add_vfs', { source: '.' }, 200, { auth })()
        const name = res?.name
        if (typeof name !== 'string' || !name)
            throw "missing name"
        await reqApi('del_vfs', { uris: ['/' + name] }, data => [0, 404].includes(data?.errors?.[0]), { auth })().catch(() => {})
    })
    test('account rename updates nested VFS permissions', async () => {
        const oldUsername = `vfs-old-${randomId(6)}`.toLowerCase()
        const newUsername = `vfs-new-${randomId(6)}`.toLowerCase()
        const name = `vfs-account-${randomId(6)}`
        try {
            await reqApi('add_account', { username: oldUsername }, 200, { auth })()
            await reqApi('add_vfs', {
                source: '.',
                name,
                can_read: { this: [oldUsername], children: [oldUsername] },
            }, 200, { auth })()
            await reqApi('set_account', { username: oldUsername, changes: { username: newUsername } }, 200, { auth })()
            await reqApi('get_vfs', {}, res => {
                const permission = _.find(res?.root?.children, { name })?.can_read
                throwIf(!_.isEqual(permission, { this: [newUsername], children: [newUsername] })
                    ? 'nested VFS permission not updated' : '')
            }, { auth })()
        }
        finally {
            await reqApi('del_vfs', { uris: ['/' + name] }, 200, { auth })().catch(() => {})
            await reqApi('del_account', { username: [newUsername, oldUsername] }, 200, { auth })().catch(() => {})
        }
    })
    test('set_vfs.rename and props', async () => {
        const name = `set vfs ${randomId(6)}`
        const renamed = `${name}-renamed`
        const uri = '/' + name
        const renamedUri = '/' + renamed
        const rootsHost = `set-vfs-${randomId(6)}.example.com`
        const oldRoots = await reqApi('get_config', { only: ['roots'] }, 200, { auth })().then(res => res.roots)
        try {
            await reqApi('add_vfs', { source: '.', name }, 200, { auth })()
            await reqApi('set_config', { values: { roots: { ...oldRoots, [rootsHost]: uri } } }, 200, { auth })()
            await reqApi('set_vfs', { uri, props: { name: renamed, comment: 'test note', can_list: false } }, 200, { auth })()
            await reqApi('get_vfs', {}, res => {
                const children = res?.root?.children || []
                const oldNode = _.find(children, { name })
                const renamedNode = _.find(children, { name: renamed })
                throwIf(oldNode ? 'old node still present'
                    : !renamedNode ? 'renamed node missing'
                        : renamedNode.comment !== 'test note' ? 'comment not updated'
                            : renamedNode.can_list !== false ? 'can_list not updated' : '')
            }, { auth })()
            await reqApi('get_config', { only: ['roots'] }, res =>
                throwIf(res?.roots?.[rootsHost] === renamedUri + '/' ? '' : 'root not updated'), { auth })()
        }
        finally {
            await reqApi('set_config', { values: { roots: oldRoots } }, 200, { auth })().catch(() => {})
            await reqApi('del_vfs', { uris: [renamedUri] }, data =>
                [0, 404].includes(data?.errors?.[0]), { auth })().catch(() => {})
            await reqApi('del_vfs', { uris: [uri] }, data =>
                [0, 404].includes(data?.errors?.[0]), { auth })().catch(() => {})
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
        finally { await rmAny(resolve(UPLOAD_DISK_ROOT, rawName)) }
    })
    test('monitor.connections upload path decodes colon folder', async () => {
        const body = makeReadableThatTakes(700)
        const size = body.length
        const folderName = `colon:${randomId(4)}`
        const fileName = 'slow-upload.txt'
        const uploadPromise = reqUpload(`${UPLOAD_ROOT}${pathEncode(folderName)}/${fileName}`, () => true, body, size, 0, { auth })()
        try {
            await wait(200)
            const res = await readEventStreamOnce(`${API}get_connections`, { auth })
            await uploadPromise
            const expectedPath = `${UPLOAD_ROOT}${folderName}/${fileName}`
            const encodedPath = `${UPLOAD_ROOT}${pathEncode(folderName)}/${fileName}`
            if (!res.data.includes(expectedPath))
                throw Error('missing decoded upload path: ' + res.data)
            if (res.data.includes(encodedPath))
                throw Error('upload path still encoded: ' + res.data)
        }
        finally { await rmAny(resolve(UPLOAD_DISK_ROOT, folderName)) }
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
    test('plugins.dirEntry event', async () => {
        const script = `exports.init = api => api.events.on('dirEntry', ({ entry }) => entry.n === 'f2/' && api.events.stop)`
        await switchIt(true).finally(() => switchIt(false).catch(() => {}))

        async function switchIt(on: boolean) {
            let lastNames: any
            await reqApi('set_config', { values: { server_code: on ? script : '' } }, 200, { auth })()
            const good = await waitFor(async () => {
                const res = await reqList('/f1/', { status: 200 })()
                lastNames = res?.list?.map((x: any) => x.n)
                return on === !isInList(res, 'f2/')
            }, { interval: 100, timeout: 3000 })
            if (!good)
                throw Error("condition not met on list: " + JSON.stringify(lastNames))
        }
    })
    test('plugins.failed init cleans event handlers', async () => {
        const script = `exports.init = api => {
            api.events.on('dirEntry', ({ entry }) => entry.n === 'f2/' && api.events.stop)
            throw Error('expected init failure')
        }`
        await reqApi('set_config', { values: { server_code: script } }, 200, { auth })()
        try {
            await reqList('/f1/', { status: 200, inList: ['f2/'] })()
        }
        finally {
            await reqApi('set_config', { values: { server_code: '' } }, 200, { auth })().catch(() => {})
        }
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
    test('plugins.public traversal', async () => {
        const id = 'list-uploader'
        await reqApi('start_plugin', { id }, 200, { auth })()
        return req(`/~/plugins/${id}/../../../tests/config.yaml`, 404)()
            .finally(() => reqApi('stop_plugin', { id }, 200, { auth })())
    })
    const antibruteCfg = {
        increment: 1,           max: 60,
        blockAfter: 9999,       maxQueuePerIp: 128,
        maxQueuePerAccount: 128, maxQueueGlobal: 512,
    }
    test('antibrute.valid basic auth has no progressive delay', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            const first = await reqBasicAuth('/for-admins/', auth)
            const second = await reqBasicAuth('/for-admins/', auth)
            if (first.status !== 200) throw "first request failed"
            if (second.status !== 200) throw "second request failed"
            if (first.delay !== 0) throw "first request delayed"
            if (second.delay !== 0) throw "second request delayed"
        })
    })
    test('antibrute.valid burst has no anti-brute delay', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            const burst = await Promise.all(_.times(20, () => reqBasicAuth('/for-admins/', auth)))
            if (burst.some(x => x.status !== 200)) throw `unexpected statuses in valid burst: ${burst.map(x => x.status)}`
            if (burst.some(x => x.delay !== 0)) throw `unexpected delay in valid burst: ${burst.map(x => x.delay)}`
        })
    })
    test('antibrute.valid burst x100 has no anti-brute delay', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            const burst = await Promise.all(_.times(100, () => reqBasicAuth('/for-admins/', auth)))
            if (burst.some(x => x.status !== 200)) throw `unexpected statuses in x100 valid burst: ${burst.map(x => x.status)}`
            if (burst.some(x => x.delay !== 0)) throw `unexpected delay in x100 valid burst: ${burst.map(x => x.delay)}`
        })
    })
    test('antibrute.failed basic auth escalates delay', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            const first = await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            const second = await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            if (first.status !== 401) throw "first wrong login was not rejected"
            if (second.status !== 401) throw "second wrong login was not rejected"
            if (second.delay < 500) throw `missing delay escalation: ${second.delay}`
        })
    })
    test('antibrute.failed loginSrp1 escalates delay', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            const user = `missing-srp-${randomId(6)}`
            const first = await reqLoginSrp1(user)
            if (first.status !== 200) throw "unknown srp login was rejected at step 1"
            const repeated = await reqLoginSrp1(user)
            if (first.salt !== repeated.salt) throw "unknown srp salt was not stable"
            await login(user).then(() => { throw "unknown srp login succeeded" }, () => {})
            const second = await reqLoginSrp1(user)
            if (second.status !== 200) throw "unknown srp login was rejected at step 1"
            if (second.delay < 500) throw `missing srp delay escalation: ${second.delay}`
        })
    })
    test('antibrute.valid loginSrp1 does not count as failed login', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            const first = await reqLoginSrp1(username)
            const second = await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            if (first.status !== 200) throw "valid srp step1 was rejected"
            if (first.delay !== 0) throw `valid srp step1 was delayed: ${first.delay}`
            if (second.status !== 401) throw "wrong login was not rejected"
            if (second.delay !== 0) throw `valid srp step1 was counted as failed login: ${second.delay}`
        })
    })
    test('antibrute.successful login resets penalty', async () => {
        await withPluginConfig('antibrute', antibruteCfg, async () => {
            await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            const penalized = await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            const success = await reqBasicAuth('/for-admins/', auth)
            const afterReset = await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            if (penalized.status !== 401) throw "penalized wrong login status mismatch"
            if (penalized.delay < 500) throw `missing pre-reset delay: ${penalized.delay}`
            if (success.status !== 200) throw "successful login failed"
            if (afterReset.status !== 401) throw "post-reset wrong login status mismatch"
            if (afterReset.delay !== 0) throw `delay not reset after successful login: ${afterReset.delay}`
        })
    })
    test('antibrute.burst serializes wrong logins with delays', async () => {
        await withPluginConfig('antibrute', {
            ...antibruteCfg,
            increment: 1,
            max: 1,
            maxQueuePerIp: 3,
            maxQueuePerAccount: 3,
            maxQueueGlobal: 3,
        }, async () => {
            // seed penalty so the first burst request keeps queue slots busy
            await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            const started = Date.now()
            const burst = await Promise.all(_.times(3, () => reqBasicAuth('/for-admins/', `${username}:wrong-password`)))
            const elapsed = Date.now() - started
            const delays = burst.map(x => x.delay)
            if (burst.some(x => x.status !== 401)) throw `unexpected statuses in burst: ${burst.map(x => x.status)}`
            if (delays.some(x => x <= 0)) throw `missing delay in burst: ${delays.join(',')}`
            // the wall clock check proves requests waited in series instead of sharing one penalty window
            if (elapsed < 2500) throw `burst was not serialized: ${elapsed}`
        })
    })
    test('antibrute.queue limit rejects overflowing logins before credentials are checked', async () => {
        await withPluginConfig('antibrute', {
            ...antibruteCfg,
            increment: 1,
            max: 1,
            maxQueuePerIp: 1,
            maxQueuePerAccount: 1,
            maxQueueGlobal: 1,
        }, async () => {
            // seed penalty so the queue slot remains occupied long enough to overflow
            await reqBasicAuth('/for-admins/', `${username}:wrong-password`)
            const burst = await Promise.all(_.times(3, () => reqBasicAuth('/for-admins/', auth)))
            const counts = _.countBy(burst, 'status')
            if (counts[200] !== 1 || counts[429] !== 2)
                throw `unexpected queue limit statuses: ${burst.map(x => x.status)}`
        })
    })
})

describe('logging', () => {
    test('security-filtered traversal reaches the error log', async () => {
        const logPath = resolve(__dirname, 'work/logs/access-error.log')
        const uri = `/f1/page/.%2e/.%2e/README.md?log-test=${randomId(8)}`
        const adminJar = {}
        await reqApi('set_config', { values: { dont_log_net: '' } }, 200, { auth, jar: adminJar })()
        try {
            await req(uri, 404, { jar: {} })()
            const found = await waitFor(() =>
                existsSync(logPath) && readFileSync(logPath, 'utf8').includes(uri))
            if (!found)
                throw Error('traversal request was not written to the error log')
        }
        finally {
            await reqApi('set_config', { values: { dont_log_net: '127.0.0.1|::1' } }, 200, { auth, jar: adminJar })()
        }
    })
})

function login(usr: string, pwd=password) {
    return srpClientSequence(srp, usr, pwd, (cmd: string, params: any) =>
        reqApi(cmd, params, (x,res)=> res.statusCode < 400)())
}

function reqUpload(dest: string, tester: Tester, body?: string | Readable, size?: number, resume=0, options?: ReqOptions) {
    if (resume)
        dest += (dest.includes('?') ? '&' : '?') + 'resume=' + resume
    size ??= (body as any)?.length ?? statSync(SAMPLE_FILE_PATH).size  // it's ok that Readable.length is undefined
    const status = (tester as any).status || tester
    if (status === 200)
        tester = {
            status,
            cb(data) {
                const fn = uploadUriToPath(data.uri)
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
        body: body ?? createReadStream(SAMPLE_FILE_PATH),
        ...options,
    })
}

function uploadUriToPath(uri: string) {
    return resolve(UPLOAD_DISK_ROOT, decodeURI(uri).replace(UPLOAD_ROOT, ''))
}

async function testMaxDl(uri: string, good: number, bad: number, reqOptions: ReqOptions={}) {
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
    }, { throttle, ...reqOptions })() )) // slow down to ensure the attempted downloads are all concurrent
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
            reject(Error('event stream timeout'))
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
    return Array.isArray(res?.list) && (res.list as any[]).some(x => x.n===name)
}

function noVisibleDetails(res: any) {
    return Array.isArray(res?.details) && res.details.length === 0
}

function rmAny(path: string) {
    return path && rm(path, { recursive: true, force: true }).catch(() => {})
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

async function withPluginConfig(id: string, config: object, cb: () => Promise<void>) {
    const prev = await reqApi('get_plugin', { id }, res => res?.config && 'enabled' in res, { auth })()
    // force a deterministic plugin lifecycle to avoid races where set_plugin returns before plugin init is completed
    await reqApi('stop_plugin', { id }, 200, { auth })()
    await reqApi('set_plugin', { id, enabled: false, config }, 200, { auth })()
    await reqApi('start_plugin', { id }, 200, { auth })()
    try {
        await cb()
    }
    finally {
        await reqApi('stop_plugin', { id }, 200, { auth })()
        await reqApi('set_plugin', { id, enabled: false, config: prev.config }, 200, { auth })()
        if (prev.enabled)
            await reqApi('start_plugin', { id }, 200, { auth })()
    }
}

async function withCustomHtml(sections: Record<string, string>, cb: () => Promise<void>) {
    const prev = await reqApi('get_custom_html', {}, res => res?.sections, { auth, jar: {} })()
    await reqApi('set_custom_html', { sections: { ...prev.sections, ...sections } }, 200, { auth, jar: {} })()
    try {
        await cb()
    }
    finally {
        await reqApi('set_custom_html', { sections: prev.sections }, 200, { auth, jar: {} })()
    }
}

async function reqBasicAuth(url: string, credentials: string) {
    const authorization = 'Basic ' + Buffer.from(credentials).toString('base64')
    const response = await httpStream(defaultBaseUrl + url, {
        path: url,
        httpThrow: false,
        jar: {},
        headers: { authorization },
    })
    await stream2string(response).catch(() => '')
    const rawDelay = response.headers?.['x-anti-brute-force']
    const delayValue = Array.isArray(rawDelay) ? rawDelay[0] : rawDelay
    return {
        status: response.statusCode,
        delay: Number(delayValue) || 0,
    }
}

async function reqLoginSrp1(username: string) {
    const response = await httpStream(defaultBaseUrl + API + 'loginSrp1', {
        path: API + 'loginSrp1',
        method: 'POST',
        httpThrow: false,
        jar: {},
        headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
        body: JSON.stringify({ username }),
    })
    const data = tryJson(await stream2string(response).catch(() => ''))
    const rawDelay = response.headers?.['x-anti-brute-force']
    const delayValue = Array.isArray(rawDelay) ? rawDelay[0] : rawDelay
    return {
        status: response.statusCode,
        delay: Number(delayValue) || 0,
        salt: data?.salt,
    }
}
