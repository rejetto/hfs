import test from 'node:test'
import assert from 'node:assert/strict'
import { readPluginSearchQuery, writePluginSearchQuery } from '../src/pluginSearchQuery'
import { readSearchQuery, writeSearchQuery } from '../src/searchQuery'

test('plugin search URLs round-trip strings and arbitrary JSON criteria together', () => {
    const criteria = {
        'hash-search': 'sha512/123',
        media: { text: 'Orchestra Étoile', minDuration: '3:00', flags: [true, null, 2] },
        number: 42, boolean: false, empty: '', 'plugin.with.dots': 'a&b=+?# /',
    }
    const params = new URLSearchParams('lang=it&ps.stale=old&pluginSearch={}#ignored')
    writePluginSearchQuery(params, JSON.stringify(criteria))
    assert.equal(params.get('searchPlugin.hash-search'), 'sha512/123')
    assert.equal(params.get('lang'), 'it')
    assert.equal(params.has('ps.stale'), false)
    assert.deepEqual(JSON.parse(params.get('searchPlugins')!), { media: criteria.media, number: 42, boolean: false })
    assert.deepEqual(readPluginSearchQuery(Object.fromEntries(new URLSearchParams(params.toString()))), criteria)
    writePluginSearchQuery(params)
    assert.equal(params.toString(), 'lang=it')
})

test('legacy plugin search URLs remain valid and compact parameters take precedence', () => {
    assert.deepEqual(readPluginSearchQuery({ pluginSearch: '{"hash":{"algorithm":"md5","prefix":"abc"}}' }),
        { hash: { algorithm: 'md5', prefix: 'abc' } })
    assert.deepEqual(readPluginSearchQuery({ pluginSearch: '{"hash":"old","other":{}}', 'ps.hash': 'md5/abc' }),
        { hash: 'md5/abc', other: {} })
    const params = new URLSearchParams()
    writePluginSearchQuery(params, '{"hash":"sha512/123"}')
    assert.equal(params.toString(), 'searchPlugin.hash=sha512%2F123')
    assert.deepEqual(readPluginSearchQuery({ 'ps.__proto__': 'value' }), JSON.parse('{"__proto__":"value"}'))
})

test('malformed plugin filters cannot silently become an unfiltered search', () => {
    for (const raw of ['broken', 'null', '[]', '42']) {
        const params = new URLSearchParams('ps.stale=old')
        writePluginSearchQuery(params, raw)
        assert.equal(params.get('searchPlugins'), raw)
        assert.throws(() => readPluginSearchQuery(Object.fromEntries(params)))
        assert.throws(() => readPluginSearchQuery({ pluginSearch: raw, 'ps.hash': 'md5/abc' }))
    }
    assert.throws(() => readPluginSearchQuery({ 'ps.': 'value' }))
    assert.throws(() => readPluginSearchQuery({ 'ps.hash': ['md5/abc', 'sha512/abc'] }))
})

test('search URLs use prefixed names, preserve unrelated parameters and accept old links', () => {
    const values = { search: 'a', searchComment: 'b', wild: 'no', sizeMin: '0', sizeMax: '1024',
        creationMin: '2000-01-01T00:00:00Z', mtimeMax: '2026-01-01T00:00:00Z', pluginSearch: '{"hash":"md5/abc"}' }
    const params = new URLSearchParams({ lang: 'it', ...values, 'ps.stale': 'old' })
    writeSearchQuery(params, values)
    assert.ok([...params.keys()].every(key => key === 'lang' || key.startsWith('search')))
    assert.equal(params.get('searchSizeMin'), '0')
    assert.equal(params.get('searchWild'), 'no')
    assert.equal(params.get('searchPlugin.hash'), 'md5/abc')
    assert.equal(readSearchQuery(Object.fromEntries(params)).sizeMax, '1024')
    assert.equal(readSearchQuery({ sizeMin: '1', searchSizeMin: '2' }).sizeMin, '2')
    assert.equal(readSearchQuery({ creationMin: 'old' }).creationMin, 'old')
    assert.deepEqual(readPluginSearchQuery({ 'ps.hash': 'old', 'searchPlugin.hash': 'new' }), { hash: 'new' })
    assert.throws(() => readPluginSearchQuery({ 'searchPlugin.': 'value' }))
    assert.throws(() => readPluginSearchQuery({ 'searchPlugin.hash': ['a', 'b'] }))
    writeSearchQuery(params)
    assert.equal(params.toString(), 'lang=it')
})
