export async function getId3Tags(url: string) {
    const buf = await fetch(url, { headers: { Range: 'bytes=0-2047' } }).then(x => x.arrayBuffer())
    const dv = new DataView(buf)
    if (dv.getUint32(0) !== 0x49443303) return // ID3 identifier
    const tags: Record<string, string> = {}
    let index = 10
    while (index < buf.byteLength) {
        const frameId = String.fromCharCode(dv.getUint8(index++), dv.getUint8(index++), dv.getUint8(index++), dv.getUint8(index++))
        if (frameId === '\0\0\0\0') break
        const frameSize = dv.getUint32(index)
        index += 6 // skip size + flags
        const enc = !dv.getUint8(index++) ? 'ISO-8859-1' // 1 is for unicode
            : { 239: 'utf-8', 255: 'utf-16le', 254: 'utf-16be' }[dv.getUint8(index)] // decode bom
        tags[frameId] = new TextDecoder(enc).decode(buf.slice(index, index += frameSize - 1))
    }
    for (const [k, v] of Object.entries({ TALB: 'album', TIT2: 'title', TPE1: 'artist', TYER: 'year', TRCK: 'track' })) // easier access to main fields
        tags[v] = tags[k]
    return tags
}
