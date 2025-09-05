import { apiAssertTypes } from './misc'
import { ApiHandlers } from './apiMiddleware'
import { writeFile } from 'fs/promises'
import { pki } from 'node-forge'
import { setConfig } from './config'

export default {

    async make_self_signed_cert({ attributes, fileName }: { fileName?: string, attributes?: Record<string, string> }) {
        apiAssertTypes({
            object_undefined: { attributes },
            string_undefined: { fileName },
        })

        const keys = pki.rsa.generateKeyPair(2048)
        const cert = pki.createCertificate()
        cert.publicKey = keys.publicKey
        cert.serialNumber = '01'
        cert.validity.notBefore = new Date()
        cert.validity.notAfter = new Date()
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

        const attrs = Object.entries(attributes || {}).map(x => ({ name: x[0], value: x[1] }))
        cert.setSubject(attrs)
        cert.setIssuer(attrs)
        cert.sign(keys.privateKey)
        const ret = {
            cert: pki.certificateToPem(cert),
            private_key: pki.privateKeyToPem(keys.privateKey),
        }
        if (!fileName)
            return ret
        const configs = { cert: fileName + '.cer', private_key: fileName + '.key' }
        await writeFile(configs.private_key, ret.private_key)
        await writeFile(configs.cert, ret.cert)
        await setConfig(configs)
        return configs
    }

} satisfies ApiHandlers