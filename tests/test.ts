import axios, { AxiosRequestConfig } from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import { Done } from 'mocha'
import { srpSequence } from '@hfs/shared/srp'
import { createReadStream, rmSync } from 'fs'
import { join } from 'path'
import _ from 'lodash'
/*
import { PORT, srv } from '../src'

process.chdir('..')
const appStarted = new Promise(resolve =>
    srv.on( 'app_started', resolve) )
*/

const username = 'rejetto'
const password = 'password'
const API = '/~/api/'
const BASE_URL = 'http://localhost'

const jar = new CookieJar()
const client = wrapper(axios.create({ jar, maxRedirects: 0 }))

describe('basics', () => {
    //before(async () => appStarted)
    it('frontend', req('/', /<body>/))
    it('force slash', req('/f1', 302))
    it('list', reqList('/f1/', { inList:['f2/', 'page'] }))
    it('search', reqList('f1', { inList:['f2/'], outList:['page'] }, { search:'2' }))
    it('search root', reqList('/', { inList:['cantListPage/'], outList:['cantListPage/page/'] }, { search:'page' }))
    it('download', req('/f1/f2/alfa.txt', { re:/abcd/, mime:'text/plain' }))
    it('download.partial', req('/f1/f2/alfa.txt', /a[^d]+$/, { // only "abc" is expected
        headers: { Range: 'bytes=0-2' }
    }))
    it('bad range', req('/f1/f2/alfa.txt', 416, {
        headers: { Range: 'bytes=7-' }
    }))
    it('website', req('/f1/page/', { re:/This is a test/, mime:'text/html' }))
    it('traversal', req('/f1/page/.%2e/.%2e/README.md', 418))
    it('custom mime from above', req('/tests/page/index.html', { status: 200, mime:'text/plain' }))
    it('name encoding', req('/x%25%23x', 200))

    it('missing perm', req('/for-admins/', 401))
    it('missing perm.file', req('/for-admins/alfa.txt', 401))

    it('forbidden list', req('/cantListPage/page/', 403))
    it('forbidden list.api', reqList('/cantListPage/page/', 403))
    it('forbidden list.cant see', reqList('/cantListPage/', { outList:['page/'] }))
    it('forbidden list.but readable file', req('/cantListPage/page/gpl.png', 200))
    it('forbidden list.alternative method', reqList('/cantListPageAlt/page/', 403))
    it('forbidden list.match **', req('/cantListPageAlt/page/gpl.png', 401))

    it('cantListBut', reqList('/cantListBut/', 403))
    it('cantListBut.parent', reqList('/', { permInList: { 'cantListBut/': 'l' } }))
    it('cantListBut.child masked', reqList('/cantListBut/page', 200))

    it('cantReadBut', reqList('/cantReadBut/', 403))
    it('cantReadBut.can', req('/cantReadBut/alfa.txt', 200))
    it('cantReadBut.parent', reqList('/', { permInList: { 'cantReadBut/': '!r' } }))
    it('cantReadButChild', req('/cantReadButChild/alfa.txt', 401))
    it('cantReadButChild.parent', reqList('/', { permInList: { 'cantReadButChild/': 'R' } }))

    it('cantReadPage', reqList('/cantReadPage/page', 403))
    it('cantReadPage.zip', req('/cantReadPage/page/?get=zip', 403, { method:'HEAD' }))
    it('cantReadPage.file', req('/cantReadPage/page/gpl.png', 403))
    it('cantReadPage.parent', reqList('/cantReadPage', { permInList: { 'page/': 'lr' } }))
    it('cantReadRealFolder', reqList('/cantReadRealFolder', 403))
    it('cantReadRealFolder.file', req('/cantReadRealFolder/page/gpl.png', 403))

    it('renameChild', reqList('/renameChild/tests', { inList:['renamed1'] }))
    it('renameChild.get', req('/renameChild/tests/renamed1', /abc/))
    it('renameChild.deeper', reqList('/renameChild/tests/page', { inList:['renamed2'] }))
    it('renameChild.get deeper', req('/renameChild/tests/page/renamed2', /PNG/))

    it('cantSeeThis', reqList('/', { outList:['cantSeeThis/'] }))
    it('cantSeeThis.children', reqList('/cantSeeThis', { outList:['hi/'] }))
    it('cantSeeThisButChildren', reqList('/', { outList:['cantSeeThisButChildren/'] }))
    it('cantSeeThisButChildren.children', reqList('/cantSeeThisButChildren', { inList:['hi/'] }))
    it('cantSeeThisButChildrenMasks', reqList('/', { outList:['cantSeeThisButChildrenMasks/'] }))
    it('cantSeeThisButChildrenMasks.children', reqList('/cantSeeThisButChildrenMasks', { inList:['hi/'] }))

    it('protectFromAbove', req('/protectFromAbove/child/alfa.txt', 403))
    it('protectFromAbove.list', reqList('/protectFromAbove/child/', { inList:['alfa.txt'] }))

    const zipSize = 13010
    const zipOfs = 5000
    it('zip.head', req('/f1/?get=zip', { empty:true, length:zipSize }, { method:'HEAD' }) )
    it('zip.partial', req('/f1/?get=zip', { re:/^C3$/, length: 2 }, { headers: { Range: `bytes=${zipOfs}-${zipOfs+1}` } }) )
    it('zip.partial.resume', req('/f1/?get=zip', { re:/^C3/, length:zipSize-zipOfs }, { headers: { Range: `bytes=${zipOfs}-` } }) )
    it('zip.partial.end', req('/f1/f2/?get=zip', { re:/^6/, length:10 }, { headers: { Range: 'bytes=-10' } }) )
    it('zip.alfa is forbidden', req('/protectFromAbove/child/?get=zip&list=alfa.txt*renamed', { empty: true, length:118 }, { method:'HEAD' }))
    it('zip.cantReadPage', req('/cantReadPage/?get=zip', { length: 120 }, { method:'HEAD' }))
    it('login', reqApi('login', { username, password }, 406)) // by default, we don't support clear-text login

    it('referer', req('/f1/page/gpl.png', 403, {
        headers: { Referer: 'https://some-website.com/try-to-trick/x.com/' }
    }))

    testUpload('upload.missing perm', 401)
})

describe('accounts', () => {
    const username = 'test-Add'
    it('accounts.add', reqApi('add_account', { username }, res => res?.username === username.toLowerCase()))
    it('account.password', reqApi('change_password_others', { username, newPassword: password }, 200))
    it('accounts.remove', reqApi('del_account', { username }, 200))
})

describe('after-login', () => {
    before(() =>
        srpSequence(username, password, (cmd: string, params: any) =>
            client.post(API+cmd, params).then(x => x.data))
    )
    it('list protected', reqList('/for-admins/', { inList:['alfa.txt'] }))
    testUpload('upload', 200)
    testUpload('upload.bad path', 418, '../../')
    after(() =>
        rmSync(join(__dirname, 'temp'), { recursive: true}))
})

function testUpload(name: string, tester: Tester, path = 'temp/') {
    it(name, req('PUT/for-admins/upload/'+join(path+'gpl.png'), tester, {
        data: createReadStream(join(__dirname, 'page/gpl.png'))
    }))
}

type TesterFunction = ((data: any, fullResponse: any) => boolean)
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

function req(methodUrl: string, test:Tester, requestOptions: AxiosRequestConfig<any>={}) {
    return (done:Done) => {
        const csrf = getCookie('csrf')
        if (csrf)
            Object.assign(requestOptions.data, { csrf })

        // all url starts with /, so if one doesn't it's because the method is prefixed
        const i = methodUrl.indexOf('/')
        const method = methodUrl.slice(0,i) || requestOptions?.data && 'POST' || 'GET'
        const url = BASE_URL+methodUrl.slice(i)
        client.request({ method, url, ...requestOptions })
            .then(process, process)
            .catch(err => {
                done(err)
            })

        function process(res:any) {
            //console.debug('sent', requestOptions, 'got', res instanceof Error ? String(res) : [res.status])
            if (test && test instanceof RegExp)
                test = { re:test }
            if (typeof test === 'number')
                test = { status: test }
            if (typeof test === 'object') {
                const { status, mime, re, inList, outList, length, permInList } = test
                const gotMime = res.headers?.['content-type']
                const gotStatus = (res.status|| res.response.status)
                const gotLength = res.headers?.['content-length']
                const err = mime && !gotMime?.startsWith(mime) && 'expected mime ' + mime + ' got ' + gotMime
                    || status && gotStatus !== status && 'expected status ' + status + ' got ' + gotStatus
                    || re && !(typeof res.data === 'string' && re.test(res.data)) && 'expected content '+String(re)+' got '+res.data
                    || inList && !inList.every(x => isInList(res.data, x)) && 'expected in list '+inList
                    || outList && !outList.every(x => !isInList(res.data, x)) && 'expected not in list '+outList
                    || permInList && findFirst(permInList, (v, k) => {
                        const got = _.find(res.data.list, { n: k })?.p
                        const negate = v[0] === '!'
                        return findFirst(v.slice(negate ? 1 : 0).split(''), char =>
                            got?.includes(char) === negate ? `expected perm ${v} on ${k}, got ${got}` : undefined)
                    })
                    || test.empty && res.data && 'expected empty body'
                    || length !== undefined && gotLength !== String(length) && "expected content-length " + length + " got " + gotLength
                    || test.cb?.(res.data, res) === false && 'error'
                    || ''
                return done(err && Error(err))
            }
            const ok = test(res.data, res)
            done(!ok && Error())
        }
    }
}

function getCookie(k: string) {
    return jar.getCookiesSync(BASE_URL).find(c => c.key === k)?.value
}

function reqApi(api: string, params: object, test:Tester) {
    return req(API+api, test, { data: params })
}

function reqList(uri:string, tester:Tester, params?: object) {
    return reqApi('file_list', { uri, ...params }, tester)
}

function isInList(res:any, name:string) {
    return Array.isArray(res?.list) && Boolean((res.list as any[]).find(x => x.n===name))
}

export function findFirst<I, O>(a: I[] | Record<string, I>, cb:(v:I, k: string | number)=>O): any {
    if (a) for (const k in a) {
        const ret = cb((a as any)[k] as I, k)
        if (ret !== undefined)
            return ret
    }
}