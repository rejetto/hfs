const axios = require('axios')

describe('file', () => {
    itHttp('md', '/dev-notes.md', '#')
    itHttp('frontend', '/', '<body>')
    itHttp('api.list', '/~/api/file_list', data => Array.isArray(data.list))
})

type Tester = (x:any) => boolean

function itHttp(name: string, uri: string, test: string | Tester) {
    it(name, () =>
        axios.get(uri).then((res: any) => {
            if (typeof test === 'string') {
                if (!res.data.includes(test))
                    throw 'bad content: ' + res.data
            }
            else if (typeof test === 'function')
                if (!test(res.data))
                    throw 'test failed: ' + JSON.stringify(res.data)
        }) )
}