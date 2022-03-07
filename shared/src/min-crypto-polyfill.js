export {}
// this is the minimum required for lib tssrp6a to work
if (!window.crypto?.subtle) {
    console.debug('poly subtle')

    const subtle = {
        async digest(algo, buff) {
            if (algo !== 'SHA-512')
                return alert(algo + ' required but not supported')
            const lib = await import('js-sha512')
            const sha = lib.default.arrayBuffer
            return sha(buff)
        }
    }
    if (!window.crypto)
        window.crypto = { subtle }
    if (!crypto.subtle)
        crypto.subtle = subtle
}
