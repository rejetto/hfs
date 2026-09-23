import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { Resolver } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    certificateNames, dnsChallengeRecord, dnsProviderInfo, getDnsProviders, presentHttpDns,
    registerAcmeDnsProvider, waitForDnsRecord, DnsRecipe,
} from '../src/acmeDns'

const catalog: DnsRecipe[] = JSON.parse(readFileSync(resolve(__dirname, '../central.json'), 'utf8')).acmeDns

test('certificate names expand each wildcard once, normalize IDN, and retain IP certificates', () => {
    assert.deepEqual(certificateNames(['*.EXAMPLE.com', 'example.com', '*.files.example.com', '192.0.2.1', 'bücher.example']),
        ['*.example.com', 'example.com', '*.files.example.com', 'files.example.com', '192.0.2.1', 'xn--bcher-kva.example'])
    for (const invalid of ['', '*example.com', '*.127.0.0.1', 'http://example.com', 'a..example.com'])
        assert.throws(() => certificateNames([invalid]))
})

test('catalog separates aliases, optional labels, disabling, incompatible drivers and plugin lifetime', () => {
    const recipes = structuredClone(catalog)
    recipes[0].providers.Zulu = { endpoint: 'https://api.cloudflare.com/client/v4', label: 'Alpha', enabled: false }
    const rows = dnsProviderInfo(recipes)
    assert.equal(rows[0].label, 'Alpha')
    assert.equal(rows[0].available, false)
    assert.equal(rows.find(p => p.id === 'Cloudflare')?.label, 'Cloudflare')
    assert.equal(dnsProviderInfo([{ ...recipes[0], driver: 'future-driver' }]).length, 0)
    assert.equal(getDnsProviders(catalog).get('IONOS')?.propagation_timeout, 900)
    for (const invalid of [{ auth: 'unknown' }, { auth: {} }, { propagation_timeout: -1 },
        { prepare: [{ method: 'GET', path: '/zones', select: { field: 'name' } }] }])
        assert.deepEqual([...getDnsProviders([{ ...recipes[0], ...invalid }, ...catalog.slice(1)]).keys()],
            [...getDnsProviders(catalog).keys()].filter(id => id !== 'Cloudflare'))
    const off = registerAcmeDnsProvider('test-dns', { config_version: 1, fields: {}, present: async () => async () => {} })
    assert(getDnsProviders([]).has('test-dns'))
    assert.throws(() => registerAcmeDnsProvider('test-dns', { config_version: 1, fields: {}, present: async () => async () => {} }))
    off()
    assert(!getDnsProviders([]).has('test-dns'))
    recipes[0].providers.Cloudflare.endpoint = 'https://other.example/api'
    assert(getDnsProviders(recipes).has('Cloudflare'))
    recipes[0].providers.Cloudflare.endpoint = 'http://other.example/api'
    const filtered = getDnsProviders(recipes)
    assert(!filtered.has('Cloudflare'))
    assert(filtered.has('Zulu'))
    assert(filtered.has('DigitalOcean'))
    assert.equal(getDnsProviders([null, ...catalog]).size, getDnsProviders(catalog).size)
    const unregister = registerAcmeDnsProvider('Cloudflare', { config_version: 1, fields: {}, present: async () => async () => {} })
    try { assert.throws(() => getDnsProviders(catalog), /Duplicate DNS provider/) }
    finally { unregister() }
})

test('catalog HTTP recipes preserve existing TXT records across parallel wildcard/apex challenges and report failures', async t => {
    for (const provider of ['Cloudflare', 'DigitalOcean']) await t.test(provider, async t => {
        const recipe = catalog.find(r => provider in r.providers)!
        const records = new Map([['existing', 'pre-existing-value']])
        let fail = '', serial = 0
        const server = createServer(async (req, res) => {
            let body = ''; for await (const chunk of req) body += chunk
            const data = body ? JSON.parse(body) : undefined
            function reply(status: number, data?: object) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(data ? JSON.stringify(data) : '') }
            try {
                assert.equal(req.headers.authorization, 'Bearer dummy-token')
                if (fail === 'network') { req.socket.destroy(); return }
                if (fail === 'large') { res.setHeader('content-length', 2 * 1024 * 1024); res.end(); return }
                if (fail === 'json') { res.end('not json dummy-token'); return }
                if (fail === 'http') return reply(403, { errors: ['dummy-token should never be reflected'] })
                if (fail === 'redirect') { res.writeHead(302, { location: 'https://other.example/' }); return res.end() }
                if (fail === 'business') return reply(200, { success: false })
                if (req.method === 'GET') {
                    assert.equal(req.url, '/zones?name=example.test')
                    return reply(200, { success: true, result: [{ id: 'zone-1' }] })
                }
                if (req.method === 'POST') {
                    assert.equal(req.url, provider === 'Cloudflare' ? '/zones/zone-1/dns_records' : '/domains/example.test/records')
                    assert.equal(data.type, 'TXT'); assert.equal(data.name, '_acme-challenge.example.test')
                    const id = String(++serial)
                    records.set(id, provider === 'Cloudflare' ? data.content : data.data)
                    return reply(200, provider === 'Cloudflare' ? { success: true, result: { id } } : { domain_record: { id: Number(id) } })
                }
                assert.equal(req.method, 'DELETE')
                const id = req.url!.split('/').at(-1)!
                assert(records.has(id)); records.delete(id)
                return reply(provider === 'Cloudflare' ? 200 : 204, provider === 'Cloudflare' ? { success: true } : undefined)
            }
            catch (e) { reply(500, { message: String(e) }) }
        })
        server.listen(0, '127.0.0.1'); await once(server, 'listening')
        t.after(() => { server.closeAllConnections(); server.close() })
        const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
        const present = (value: string) => presentHttpDns(recipe, endpoint,
            { name: '_acme-challenge.example.test', zone: 'example.test', relative: '_acme-challenge', value }, { token: 'dummy-token' })
        const cleanups = await Promise.all([present('apex-token'), present('wildcard-token')])
        assert.deepEqual(new Set(records.values()), new Set(['pre-existing-value', 'apex-token', 'wildcard-token']))
        await Promise.all(cleanups.map(cleanup => cleanup()))
        assert.deepEqual([...records.values()], ['pre-existing-value'])
        for (const mode of ['http', 'redirect', ...provider === 'Cloudflare' ? ['business'] : []]) {
            fail = mode
            await assert.rejects(present('not-created'), error => error instanceof Error && !error.message.includes('dummy-token'))
        }
        fail = ''
        fail = 'network'
        await assert.rejects(present('interrupted'), /DNS API connection failed \(ECONNRESET\)/)
        fail = 'large'
        await assert.rejects(present('too-large'), /DNS API response exceeds 1 MB/)
        fail = 'json'
        await assert.rejects(present('invalid-json'), /DNS API returned invalid JSON/)
        fail = 'http'
        await assert.rejects(present('forbidden'), /HTTP 403/)
        fail = ''
        const cleanup = await present('cleanup-error')
        fail = 'http'
        await assert.rejects(cleanup())
        assert.equal(records.size, 2)
    })
})

test('DNS-01 follows challenge CNAMEs, finds the SOA zone, and waits for the actual TXT value', { timeout: 10_000 }, async t => {
    const socket = createSocket('udp4')
    let published = false
    socket.on('message', (query, client) => {
        const labels: string[] = []; let pos = 12
        while (query[pos]) { const size = query[pos++]; labels.push(query.subarray(pos, pos + size).toString()); pos += size }
        const name = labels.join('.'); const type = query.readUInt16BE(pos + 1)
        const end = pos + 5
        let data: Buffer | undefined
        if (type === 5 && name === '_acme-challenge.example.test') data = dnsName('token.validation.test')
        if (type === 6 && name === 'validation.test') data = Buffer.concat([dnsName('ns.validation.test'), dnsName('hostmaster.validation.test'), Buffer.alloc(20)])
        if (type === 16 && name === 'token.validation.test' && published) data = Buffer.from([3, ...Buffer.from('abc'), 3, ...Buffer.from('def')])
        const header = Buffer.from(query.subarray(0, 12)); header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(data ? 1 : 0, 6)
        header.writeUInt16BE(0, 8); header.writeUInt16BE(0, 10)
        const answer = Buffer.alloc(12)
        answer.writeUInt16BE(0xc00c); answer.writeUInt16BE(type, 2); answer.writeUInt16BE(1, 4); answer.writeUInt16BE(data?.length || 0, 10)
        socket.send(Buffer.concat([header, query.subarray(12, end), ...data ? [answer, data] : []]), client.port, client.address)
    })
    socket.bind(0, '127.0.0.1'); await once(socket, 'listening')
    t.after(() => socket.close())
    const resolver = new Resolver({ timeout: 1000, tries: 1 })
    resolver.setServers([`127.0.0.1:${socket.address().port}`])
    const record = await dnsChallengeRecord('example.test', 'abcdef', resolver)
    assert.deepEqual(record, { name: 'token.validation.test', zone: 'validation.test', relative: 'token', value: 'abcdef' })
    const timer = setTimeout(() => { published = true }, 100)
    t.after(() => clearTimeout(timer))
    await waitForDnsRecord(record, resolver)
})
function dnsName(name: string) {
    return Buffer.concat([...name.split('.').map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0])])
}
