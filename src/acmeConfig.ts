import { defineConfig, setConfig } from './config'
import { CFG } from './cross-const'
import { getProjectInfo } from './github'
import { AcmeDnsConfig, dnsProviderInfo } from './acmeDns'

export const acmeDomain = defineConfig(CFG.acme_domain, '')
export const acmeRenew = defineConfig(CFG.acme_renew, false)
export const acmeChallenge = defineConfig<'http-01' | 'dns-01'>(CFG.acme_challenge, 'http-01')
export const acmeDns = defineConfig<AcmeDnsConfig[]>(CFG.acme_dns, [])
export interface AcmeSettings {
    domain: string
    renew: boolean
    challenge: 'http-01' | 'dns-01'
    dns: AcmeDnsConfig[]
}
export async function getAcmeSettings() {
    return {
        domain: acmeDomain.get(), renew: acmeRenew.get(), challenge: acmeChallenge.get(),
        dns: acmeDns.get(), providers: dnsProviderInfo((await getProjectInfo()).acmeDns),
    }
}
export async function setAcmeSettings(settings: AcmeSettings) {
    if (typeof settings.domain !== 'string' || typeof settings.renew !== 'boolean'
        || !['http-01', 'dns-01'].includes(settings.challenge) || !Array.isArray(settings.dns) || settings.dns.length > 1)
        throw Error("Invalid certificate settings")
    const providers = dnsProviderInfo((await getProjectInfo()).acmeDns)
    const configs = settings.dns.map(config => {
        if (!config || typeof config.id !== 'string' || !config.id || !config.credentials || typeof config.credentials !== 'object'
            || Object.values(config.credentials).some(value => typeof value !== 'string')) throw Error("Invalid DNS configuration")
        const previous = acmeDns.get().find(c => c.id === config.id && c.provider === config.provider && c.config_version === config.config_version)
        const provider = providers.find(p => p.id === config.provider && p.config_version === config.config_version)
        // retain unavailable credentials so switching back to HTTP doesn't require discarding them
        if (!provider && previous) return config
        if (!provider || Object.keys(config.credentials).some(key => !(key in provider.fields)))
            throw Error("Invalid DNS configuration; select a supported provider")
        return { id: config.id, provider: config.provider, config_version: config.config_version, credentials: config.credentials }
    })
    await setConfig({
        [CFG.acme_domain]: settings.domain, [CFG.acme_renew]: settings.renew,
        [CFG.acme_challenge]: settings.challenge, [CFG.acme_dns]: configs,
    })
    return getAcmeSettings()
}
