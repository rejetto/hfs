export {}
// this is the minimum required for lib tssrp6a to work
window.crypto ||= {}
crypto.subtle ||= console.debug("using polyfill for crypto.subtle") || {}
crypto.subtle.digest ||= async (algo, buff) => {
    if (algo !== 'SHA-512')
        return alert(algo + ' required but not supported')
    const lib = await import('js-sha512')
    const sha = lib.default.arrayBuffer
    return sha(buff)
}
