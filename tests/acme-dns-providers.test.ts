import test from 'node:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { presentHttpDns, DnsRecipe } from '../src/acmeDns'

test('additional DNS catalog providers preserve records and authenticate HTTP requests', async t => {
    const recipes: DnsRecipe[] = JSON.parse(readFileSync(resolve(__dirname, '../central.json'), 'utf8')).acmeDns
        .filter((r: DnsRecipe) => !('Cloudflare' in r.providers) && !('DigitalOcean' in r.providers))
    for (const recipe of recipes) for (const provider of Object.keys(recipe.providers)) await t.test(provider, async () => {
        const ovh = provider.startsWith('OVHcloud')
        const records = new Map([['old', 'preexisting']])
        const failures: unknown[] = []
        let serial = 0, mode = '', refreshes = 0
        const serverTime = 1700000000
        const basePath = new URL(recipe.providers[provider]!.endpoint).pathname
        const server = createServer(async (req, res) => {
            try {
                let raw = ''; for await (const chunk of req) raw += chunk
                const body = raw ? JSON.parse(raw) : undefined
                const path = req.url!.slice(basePath.length)
                function reply(data: unknown, status = 200) { res.writeHead(status, {'content-type':'application/json'}); res.end(data === undefined ? '' : JSON.stringify(data)) }
                if (provider === 'Porkbun') { assert.equal(body.apikey, 'key'); assert.equal(body.secretapikey, 'secret') }
                else if (ovh) {
                    if (path === '/auth/time') {
                        assert.equal(req.headers['x-ovh-signature'], undefined)
                        return reply(mode === 'time' ? 'invalid' : serverTime)
                    }
                    assert.equal(req.headers['x-ovh-application'], 'app-key')
                    assert.equal(req.headers['x-ovh-consumer'], 'consumer-key')
                    const time = Number(req.headers['x-ovh-timestamp'])
                    assert(Math.abs(time - serverTime) < 3)
                    const signed = ['app-secret', 'consumer-key', req.method, 'http://' + req.headers.host + req.url, raw, time].join('+')
                    assert.equal(req.headers['x-ovh-signature'], '$1$' + createHash('sha1').update(signed).digest('hex'))
                }
                else if (provider === 'IONOS') assert.equal(req.headers['x-api-key'], 'token')
                else if (provider === 'Name.com') assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('user:token').toString('base64'))
                else assert.equal(req.headers.authorization, 'Bearer token')
                if (mode === 'redirect') { res.writeHead(302, { location: 'https://other.example' }); return res.end() }
                if (mode === 'business') return reply({ status: 'ERROR' })
                if (mode === 'message') return reply({ message: 'This call has not been granted: token secret' }, 403)
                if (mode === 'denied') return reply({message:'token secret', errorCode:'NOT_GRANTED_CALL'}, 403)
                if (path.endsWith('/refresh')) {
                    assert.equal(req.method, 'POST'); assert.equal(path, '/domain/zone/example.test/refresh')
                    refreshes++
                    if (mode === 'refresh') { mode = ''; return reply({message:'failed refresh'},500) }
                    return reply(null)
                }
                if (req.method === 'GET') {
                    if (provider === 'Linode') { assert.equal(path, '/domains'); assert.deepEqual(JSON.parse(String(req.headers['x-filter'])), {domain:'example.test'}); return reply({results:1,data:[{id:23}]}) }
                    if (provider === 'DNSimple') { assert.equal(path, '/whoami'); return reply({data:{account:{id:42}}}) }
                    assert.equal(provider, 'IONOS'); assert.equal(path, '/zones')
                    return reply([{name:'other.test',id:'wrong'}, ...mode === 'missing' ? [] : [{name:'example.test',id:'zone-id'}], ...mode === 'duplicate' ? [{name:'example.test',id:'ambiguous'}] : []])
                }
                const prefix = ovh ? '/domain/zone/example.test/record' : provider === 'Porkbun' ? '/dns/create/example.test' : provider === 'Linode' ? '/domains/23/records'
                    : provider === 'DNSimple' ? '/42/zones/example.test/records' : provider === 'IONOS' ? '/zones/zone-id/records' : '/domains/example.test/records'
                if (req.method === 'POST' && path === prefix) {
                    const record = provider === 'IONOS' ? body[0] : body
                    assert.equal(record.type ?? record.fieldType, 'TXT')
                    assert.equal(record.name ?? record.host ?? record.subDomain, provider === 'IONOS' ? '_acme-challenge.example.test' : '_acme-challenge')
                    const value = record.content ?? record.data ?? record.target ?? record.answer
                    assert.equal(record.ttl ?? record.ttl_sec, provider === 'Porkbun' ? '300' : ovh ? 60 : 300)
                    const id = String(++serial); records.set(id, value)
                    return reply(provider === 'Porkbun' ? {status:'SUCCESS',id} : provider === 'Vultr' ? {record:{id}}
                        : provider === 'DNSimple' ? {data:{id:Number(id)}} : provider === 'IONOS' ? [{id}] : {id:Number(id)}, 201)
                }
                const id = path.split('/').pop()!
                assert.equal(path, provider === 'Porkbun' ? '/dns/delete/example.test/'+id : prefix+'/'+id)
                assert.equal(req.method, provider === 'Porkbun' ? 'POST' : 'DELETE')
                assert(records.delete(id)); reply(provider === 'Porkbun' ? {status:'SUCCESS'} : undefined, provider === 'Porkbun' ? 200 : 204)
            }
            catch (e) { failures.push(e); res.writeHead(500); res.end('{}') }
        })
        server.listen(0,'127.0.0.1'); await once(server,'listening')
        try {
            const endpoint = 'http://127.0.0.1:'+(server.address() as {port:number}).port + basePath
            const create = (value: string) => presentHttpDns(recipe,endpoint,{name:'_acme-challenge.example.test',zone:'example.test',relative:'_acme-challenge',value},{token:'token',key:'key',secret:'secret',username:'user',applicationKey:'app-key',applicationSecret:'app-secret',consumerKey:'consumer-key'})
            const cleanups = await Promise.all([create('apex'),create('wildcard')])
            assert.deepEqual(new Set(records.values()),new Set(['preexisting',...provider==='Vultr'?['"apex"','"wildcard"']:['apex','wildcard']]))
            await Promise.all(cleanups.map(fn=>fn()))
            assert.deepEqual([...records], [['old','preexisting']])
            if (ovh) {
                assert.equal(refreshes, 4)
                mode = 'refresh'
                await assert.rejects(create('refresh-failed'))
                assert.deepEqual([...records], [['old','preexisting']])
                assert.equal(refreshes, 6)
                mode = 'time'; await assert.rejects(create('invalid-time'), /server time/)
            }
            if (provider === 'IONOS') for (const failure of ['missing', 'duplicate']) {
                mode = failure
                await assert.rejects(create('missing-zone'), /zone missing or ambiguous/)
                assert.deepEqual([...records], [['old','preexisting']])
            }
            if (ovh) {
                mode = 'message'
                await assert.rejects(create('message-only'), (e: Error) =>
                    e.message.includes('This call has not been granted') && !e.message.includes('token secret'))
            }
            for (const failure of ['denied', 'redirect', ...provider === 'Porkbun' ? ['business'] : []]) {
                mode = failure
                await assert.rejects(create('failure'), (e: Error) => !e.message.includes('token secret') && (mode !== 'denied' || !ovh || e.message.includes('NOT_GRANTED_CALL')))
            }
            assert.deepEqual(failures,[])
        }
        finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())) }
    })
})
