import axios from 'axios'
import { Done } from 'mocha'
/*
import { PORT, srv } from '../src'

process.chdir('..')
const appStarted = new Promise(resolve =>
    srv.on( 'app_started', resolve) )
*/
describe('basics', () => {
    //before(async () => appStarted)
    it('frontend', req('/', s => s.includes('<body>')))
    it('api.list', req('/~/api/file_list', res => inList(res, 'f2/') && inList(res, 'f3/'), {
        data: { path:'/f1/' }
    }))
    it('api.search', req('/~/api/file_list', res => inList(res, 'f2/') && !inList(res, 'f3/'), {
        data: { path:'f1', search:'2' }
    }))
    it('download', req('/f1/f2/alfa.txt', s => s.includes('abcd')))
    it('partial download', req('/f1/f2/alfa.txt', s => s.includes('a') && !s.includes('d'), {
        headers: { Range: 'bytes=0-2' }
    }))
    it('missing perm', req('/for-rejetto/', 404))
    it('proxy', req('/proxy', s => s.includes('github')))
})

type Tester = number | ((data:any, fullResponse:any) => boolean | Error)

function req(methodUrl: string, test:Tester, requestOptions?:any) {
    return (done:Done) => {
        const i = methodUrl.indexOf('/')
        const method = methodUrl.slice(0,i) || requestOptions?.data && 'POST' || 'GET'
        const url = 'http://localhost'+methodUrl.slice(i)
        function fun(res:any) {
            if (typeof test === 'number') {
                const ok = (res.status || res.response.status) === test
                return done(!ok && 'expected code '+test)
            }
            const ok = test(res.data, res)
            if (!ok)
                console.debug('sent', requestOptions, 'got',res.data)
            done(!ok && Error())
        }
        axios.request({ method, url, ...requestOptions })
            .then(fun, fun)
            .catch(err => {
                done(err)
            })
    }
}

function inList(res:any, name:string) {
    return Array.isArray(res.list) && Boolean(res.list.find((x:any) => x.n===name))
}
