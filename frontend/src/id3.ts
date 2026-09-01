export async function getId3Tags(url: string) {
    const buf = await fetch(url, { headers: { Range: 'bytes=0-2047' } }).then(x => x.arrayBuffer())
    const dv = new DataView(buf)
    const version = dv.getUint32(0)
    if (version !== 0x49443303 && version !== 0x49443304) return // ID3 identifier and supported version
    const tags: Record<string, string> = {}
    let index = 10
    while (index < buf.byteLength) {
        const frameId = String.fromCharCode(dv.getUint8(index++), dv.getUint8(index++), dv.getUint8(index++), dv.getUint8(index++))
        if (frameId === '\0\0\0\0') break
        const frameSize = version === 0x49443304
            ? dv.getUint8(index) << 21 | dv.getUint8(index + 1) << 14 | dv.getUint8(index + 2) << 7 | dv.getUint8(index + 3)
            : dv.getUint32(index)
        index += 6 // skip size + flags
        const encoding = dv.getUint8(index++)
        const enc = !encoding ? 'ISO-8859-1'
            : encoding === 2 ? 'utf-16be'
                : encoding === 3 ? 'utf-8'
                    : { 239: 'utf-8', 255: 'utf-16le', 254: 'utf-16be' }[dv.getUint8(index)] // decode bom
        tags[frameId] = new TextDecoder(enc).decode(buf.slice(index, index += frameSize - 1))
    }
    for (const [k, v] of Object.entries({ TALB: 'album', TIT2: 'title', TPE1: 'artist', TYER: 'year', TDRC: 'year', TRCK: 'track' })) { // easier access to main fields
        if (k in tags)
            tags[v] = tags[k].split('\0', 1)[0]
    }
    return tags
}
