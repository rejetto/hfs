import axios from 'axios'
import { Done } from 'mocha'
/*
import { PORT, srv } from '../src'

process.chdir('..')
const appStarted = new Promise(resolve =>
    srv.on( 'app_started', resolve) )
*/

const user = 'rejetto'
const password = 'password'

describe('basics', () => {
    //before(async () => appStarted)
    it('frontend', req('/', s => s.includes('<body>')))
    it('api.list', req('/~/api/file_list', data => inList(data, 'f2/') && inList(data, 'page'), {
        data: { path:'/f1/' }
    }))
    it('api.search', req('/~/api/file_list', data => inList(data, 'f2/') && !inList(data, 'page'), {
        data: { path:'f1', search:'2' }
    }))
    it('download', req('/f1/f2/alfa.txt', s => s.includes('abcd')))
    it('partial download', req('/f1/f2/alfa.txt', s => s.includes('a') && !s.includes('d'), {
        headers: { Range: 'bytes=0-2' }
    }))
    it('website', req('/f1/page/', s => s.includes('This is a test')))
    it('missing perm', req('/for-admins/', 404))
    it('proxy', req('/proxy', s => s.includes('github')))
    it('login', req('/~/api/login', 200, {
        data: { user, password }
    }))
})

let cookie:any
describe('after-login', () => {
    before(req('/~/api/login', (data, res) => Boolean(cookie = res.headers['set-cookie']), {
        data: { user, password }
    }))
    it('list protected', done => // defer execution of req() to have cookie set
        req('/~/api/file_list', data => inList(data, 'alfa.txt'), {
            data: { path:'/for-admins/' },
            headers: { cookie },
        })(done))
})

type Tester = number | ((data:any, fullResponse:any) => boolean | Error)

function req(methodUrl: string, test:Tester, requestOptions?:any) {
    return (done:Done) => {
        const i = methodUrl.indexOf('/')
        const method = methodUrl.slice(0,i) || requestOptions?.data && 'POST' || 'GET'
        const url = 'http://localhost'+methodUrl.slice(i)
        axios.request({ method, url, ...requestOptions })
            .then(fun, fun)
            .catch(err => {
                done(err)
            })

        function fun(res:any) {
            console.debug('sent', requestOptions, 'got', res instanceof Error ? String(res) : res)
            if (typeof test === 'number') {
                const got = res.status || res.response.status
                const ok = got === test
                return done(!ok && 'expected code '+test)
            }
            const ok = test(res.data, res)
            done(!ok && Error())
        }
    }
}

function inList(res:any, name:string) {
    return Array.isArray(res?.list) && Boolean((res.list as any[]).find(x => x.n===name))
}
