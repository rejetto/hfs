import { defineConfig } from './config'
import { parse } from 'node:url'
import { httpStream } from './util-http'

// don't move this in util-http, where it would mostly belong, as a require to config.ts would prevent tests using util-http
defineConfig('outbound_proxy', '', v => {
    try {
        parse(v)
        httpStream.defaultProxy = v
    }
    catch {
        console.warn("invalid URL", v)
        return ''
    }
})
