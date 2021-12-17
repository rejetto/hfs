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
    it('api.list', req('/~/api/file_list', s => Array.isArray(s.list)))
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
        const method = methodUrl.slice(0,i) || 'GET'
        const url = 'http://localhost'+methodUrl.slice(i)
        function fun(res:any) {
            return done(typeof test === 'number' ? (res.status || res.response.status) !== test : !test(res.data, res))
        }
        axios.request({ method, url, ...requestOptions })
            .then(fun, fun)
            .catch(err => {
                done(err)
            })
    }
}
