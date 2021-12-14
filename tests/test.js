"use strict";
const axios = require('axios');
describe('file', () => {
    itHttp('md', '/NOTES.md', '##');
    itHttp('frontend', '/', '<body>');
    itHttp('api.list', '/~/api/file_list', data => Array.isArray(data.list));
});
function itHttp(name, uri, test) {
    it(name, () => axios.get(uri).then((res) => {
        if (typeof test === 'string') {
            if (!res.data.includes(test))
                throw 'bad content: ' + res.data;
        }
        else if (typeof test === 'function')
            if (!test(res.data))
                throw 'test failed: ' + JSON.stringify(res.data);
    }));
}
