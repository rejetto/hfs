import test, { describe, before, after } from 'node:test';
import { promisify } from 'util'
import { srpClientSequence } from '../src/srp'
import { createReadStream, statfsSync, statSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { exec } from 'child_process'
import _ from 'lodash'
import { findDefined, randomId, try_, tryJson, wait } from '../src/cross'
import { httpStream, stream2string, XRequestOptions } from '../src/util-http'
import { ThrottledStream, ThrottleGroup } from '../src/ThrottledStream'
import { access, rm, writeFile } from 'fs/promises'
import { Readable } from 'stream'
/*
import { PORT, srv } from '../src'

process.chdir('..')
const appStarted = new Promise(resolve =>
    srv.on( 'app_started', resolve) )
*/

const username = 'rejetto'
const password = 'password'
const API = '/~/api/'
const ROOT = 'tests/'
const BASE_URL = 'http://[::1]:81'
const BASE_URL_127 = 'http://127.0.0.1:81'
const UPLOAD_ROOT = '/for-admins/upload/'
const UPLOAD_RELATIVE = 'temp/gpl.png'
const UPLOAD_DEST = UPLOAD_ROOT + UPLOAD_RELATIVE
const BIG_CONTENT = _.repeat(randomId(10), 300_000) // 3MB, big enough to saturate buffers
const throttle = BIG_CONTENT.length /1000 /0.8 // KB, finish in 0.8s, quick but still overlapping downloads
const SAMPLE_FILE_PATH = resolve(__dirname, 'page/gpl.png')
let defaultBaseUrl = BASE_URL

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

describe('basics', () => {
    //before(async () => appStarted)
    test('frontend', req('/', /<body>/, { headers: { accept: '*/*' } })) // workaround: 'accept' is necessary when running server-for-test-dev, still don't know why
    test('force slash', req('/f1', 302, { noRedirect: true }))
    test('list', reqList('/f1/', { inList:['f2/', 'page/'] }))
    test('search', reqList('f1', { inList:['f2/'], outList:['page'] }, { search:'2' }))
    test('search root', reqList('/', { inList:['cantListPage/'], outList:['cantListPage/page/'] }, { search:'page' }))
    test('download.mime', req('/f1/f2/alfa.txt', { re:/abcd/, mime:'text/plain' }))
    test('download.partial', req('/f1/f2/alfa.txt', /a[^d]+$/, { // only "abc" is expected
        headers: { Range: 'bytes=0-2' }
    }))
    test('bad range', req('/f1/f2/alfa.txt', 416, {
        headers: { Range: 'bytes=7-' }
    }))
    test('roots', req('/f2/alfa.txt', 200, { baseUrl: BASE_URL_127 })) // host 127.0.0.1 is rooted in /f1
    test('website', req('/f1/page/', { re:/This is a test/, mime:'text/html' }))
    test('traversal', req('/f1/page/.%2e/.%2e/README.md', 418))
    test('custom mime from above', req('/tests/page/index.html', { status: 200, mime:'text/plain' }))
    test('name encoding', req('/x%25%23x', 200))

    test('missing perm', reqList('/for-admins/', 401))
    test('missing perm.file', req('/for-admins/alfa.txt', 401))

    test('forbidden list', req('/cantListPage/page/', 403))
    test('forbidden list.api', reqList('/cantListPage/page/', 403))
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
    test('zip.alfa is forbidden', req('/protectFromAbove/child/?get=zip&list=alfa.txt//renamed', { empty: true, length:134 }, { method:'HEAD' }))
    test('zip.cantReadPage', req('/cantReadPage/?get=zip', { length: 4832 }, { method:'HEAD' }))

    test('referer', req('/f1/page/gpl.png', 403, {
        headers: { Referer: 'https://some-website.com/try-to-trick/x.com/' }
    }))

    test('upload.need account', reqUpload( UPLOAD_DEST, 401))
    test('upload.post', () => // this is also testing basic-auth
        promisify(exec)(`curl -u ${username}:${password} -F upload=@${SAMPLE_FILE_PATH} ${BASE_URL}${UPLOAD_ROOT}`).then(x => {
            let fn = tryJson(x.stdout)?.uris?.[0]
            if (!fn) throw "unexpected output " + (x.stdout || x.stderr)
            fn = resolve(__dirname, basename(decodeURI(fn)))
            const stats = statSync(fn)
            rm(fn).catch(() => {}) // clear
            if (stats?.size !== statSync(SAMPLE_FILE_PATH).size)
                throw "unexpected size for " + fn
        }))
    test('create_folder', reqApi('create_folder', { uri: UPLOAD_ROOT, name: 'temp' }, 401))
    test('delete.no perm', req('/for-admins/', 405, { method: 'delete' }))
    test('delete.need account', req(UPLOAD_ROOT + 'alfa.txt', 401, { method: 'delete'}))
    test('rename.no perm', reqApi('rename', { uri: '/for-admins', dest: 'any' }, 401))
    test('of_disabled.cantLogin', () => login('of_disabled').then(() => { throw Error('logged in') }, () => {}))
    test('allow_net.canLogin', () => login(username))
    test('allow_net.cantLogin', () => {
        defaultBaseUrl = BASE_URL_127 // 127.0.0.1 is not allowed for this account
        return login(username).then(() => { throw Error('logged in') }, () => {})
            .finally(() => defaultBaseUrl = BASE_URL)
    })

    test('folder size', reqApi('get_folder_size', { uri: 'f1/page' }, res => res.bytes === 6328 ))
    test('folder size.cant', reqApi('get_folder_size', { uri: 'for-admins' }, 401))

    test('get_accounts', reqApi('get_accounts', {}, 401)) // admin api requires login
    test('url login', () => promisify(exec)(`curl -v "${BASE_URL}/for-admins/?login=${username}:${password}"`).then(x => {
        if (!x.stdout?.includes('Redirect'))
            throw x.stderr || "failed"
    }))
})

// do this before login, or max_dl_accounts config will override max_dl
describe('limits', () => {
    const fn = ROOT + 'big'
    before(() => writeFile(fn, BIG_CONTENT))
    test('max_dl', () => testMaxDl('/' + fn, 1, 2))
    after(() => rm(fn))
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
    test('create_folder', reqApi('create_folder', { uri: UPLOAD_ROOT, name: 'temp' }, 200))
    test('inherit.perm', reqList('/for-admins/', { inList:['alfa.txt'] }))
    test('inherit.disabled', reqList('/for-disabled/', 401))
    test('upload.never', reqUpload('/random', 403))
    test('upload.ok', reqUpload(UPLOAD_DEST, 200))
    test('upload.crossing', reqUpload(UPLOAD_DEST.replace('temp', '../..'), 418))
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
            throw Error("missing temp file")
        await reqUpload(UPLOAD_DEST + '?resume=0!', 412)()
        await makeAbortedRequest(timeFirstRequest * 1.5) // upload more than r1
        if (!(size < getTempSize()!)) // should be increased, as secondary temp file got bigger and replaced primary one
            throw Error(`temp file not enlarged, it was ${size} and now it's ${getTempSize()}`)
        await reqUpload(UPLOAD_DEST, 200, makeReadableThatTakes(0))() // quickly complete the upload, and check for final size
        if (getTempSize())
            throw Error("temp file should be cleared")
        // test resume
        await makeAbortedRequest(timeFirstRequest)
        const partial = getTempSize()
        if (!partial)
            throw Error("partial file missing")
        await reqUpload(UPLOAD_DEST, 200, Readable.from(BIG_CONTENT.slice(partial)), BIG_CONTENT.length, partial)()
    })
    const renameTo = 'z'
    test('rename.ok', reqApi('rename', { uri: UPLOAD_DEST, dest: renameTo }, 200))
    test('delete.miss renamed', req(UPLOAD_DEST, 404, { method: 'delete' }))
    test('delete.ok', async () => {
        const fn = resolve(__dirname, dirname(UPLOAD_RELATIVE), renameTo)
        await access(fn)
        await req(dirname(UPLOAD_DEST) + '/' + renameTo, 200, { method: 'delete' })()
        await access(fn).then(() => { throw "not deleted" }, () => {})
    })
    test('reupload', reqUpload(UPLOAD_DEST, 200))
    test('delete.method', req(UPLOAD_DEST, 200, { method: 'DELETE' }))
    test('delete.miss deleted', req(UPLOAD_DEST, 404, { method: 'delete' }))
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
        const r1 = reqUpload(UPLOAD_ROOT + 'temp/free1', 400, makeReadableThatTakes(1000), fakeSize)()
        setTimeout(r1.abort, 1500)
        await Promise.all([
            r1.catch(() => {}),
            wait(100).then(() => reqUpload(UPLOAD_ROOT + 'temp/free2', 507, makeReadableThatTakes(500), fakeSize)())
        ])
    })
    test('max_dl.account', async () => {
        const uri = UPLOAD_ROOT + 'temp/big'
        await reqUpload(uri, 200, BIG_CONTENT)()
        await testMaxDl(uri, 2, 1)
    })
    after(() => rm(resolve(__dirname, 'temp'), { recursive: true }).catch(() => 0))
})

describe('admin', () => {
    const auth = `${username}:${password}`
    test('add folder', async () => {
        const name = 'added'
        try {
            await reqApi('add_vfs', { source: '.', name, can_see: { this: false, children: true } }, 200, { auth })() // add an invisible folder
            await reqList(name, { inList: ['plugins/'] })()
        }
        finally {
            await reqApi('del_vfs', { uris: ['/'+name] }, 200, { auth })() // remove
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
    if (tester === 200)
        tester = {
            status: tester,
            cb(data) {
                const fn = ROOT + decodeURI(data.uri).replace(UPLOAD_ROOT, '')
                const stats = try_(() => statSync(fn))
                if (!stats)
                    throw Error("uploaded file not found: " + fn)
                if (size !== stats.size)
                    throw Error(`uploaded file wrong size: ${fn} = ${stats.size.toLocaleString()} expected ${size?.toLocaleString()}`)
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

const jar = {}

function req(url: string, test:Tester, { baseUrl, throttle, ...requestOptions }: XRequestOptions & { throttle?: number, baseUrl?: string }={}) {
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
                throw Error("failed test: " + test)
        return obj ?? data
    }
}

function reqApi(api: string, params: object, test:Tester, options:any={}) {
    const isGet = api.startsWith('/')
    return req(API+api, test, {
        body: JSON.stringify(params),
        headers: isGet ? undefined : { 'x-hfs-anti-csrf': '1'},
        ...options,
    })
}

function reqList(uri:string, tester:Tester, params?: object) {
    return reqApi('get_file_list', { uri, ...params }, tester)
}

function isInList(res:any, name:string) {
    return Array.isArray(res?.list) && Boolean((res.list as any[]).find(x => x.n===name))
}