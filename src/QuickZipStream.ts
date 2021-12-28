import { crc32 } from '@node-rs/crc32'
import { Readable } from 'stream'

const ZIP64_LIMIT = 2**31 -1

interface ZipSource {
    path: string
    data: Readable
    size: number
    ts: Date
}
export class QuickZipStream extends Readable {
    private workingFile = false
    private numberOfFiles: number = 0
    private finished = false
    private readonly centralDir: ({ size:number, crc:number, ts:Date, pathAsBuffer:Buffer, offset:number, version:number })[] = []
    private dataWritten = 0

    constructor(private readonly walker:  AsyncIterableIterator<ZipSource>) {
        super({})
    }

    _push(chunk:any) {
        if (Array.isArray(chunk))
            chunk = buffer(chunk)
        this.push(chunk)
        this.dataWritten += chunk.length
    }

    async _read(): Promise<void> {
        if (this.workingFile || this.finished) return
        const { value } = await this.walker.next() as { value: ZipSource }
        if (!value)
            return this.closeArchive()
        ++this.numberOfFiles
        let { path, data, size, ts } = value
        const pathAsBuffer = Buffer.from(path, 'utf8')

        let crc: number | undefined = undefined
        const offset = this.dataWritten
        let version = 20
        this._push([
            4, 0x04034b50,
            2, version,
            2, 0x08, // flags
            2, 0, // compression = store
            ...ts2buf(ts),
            4, 0, // crc
            4, 0, // size
            4, 0, // size
            2, pathAsBuffer.length,
            2, 0, // extra length
        ])
        this._push(pathAsBuffer)

        let total = 0
        data.on('error', (err) => console.error(err))
        data.on('data', chunk => {
            this._push(chunk)
            crc = crc32(chunk, crc)
            total += chunk.length
        })
        this.workingFile = true
        data.on('end', ()=>{
            this.workingFile = false
            console.debug('zip', total, path)
            this.centralDir.push({ size, crc:crc!, pathAsBuffer, ts, offset, version })
            const sizeSize = size > ZIP64_LIMIT ? 8 : 4
            this._push([
                4, 0x08074b50,
                4, crc,
                sizeSize, size,
                sizeSize, size,
            ])
        })
    }

    closeArchive() {
        this.finished = true
        let centralOffset = this.dataWritten
        for (let { size, ts, crc, offset, pathAsBuffer, version } of this.centralDir) {
            const extra = []
            if (size > ZIP64_LIMIT) {
                extra.push(size, size)
                size = 0xffffffff
            }
            if (offset > ZIP64_LIMIT) {
                extra.push(offset)
                offset = 0xffffffff
            }
            const extraData = buffer(!extra.length ? []
                : [ 2,1, 2,8*extra.length, ...extra.map(x=> [8,x]).flat() ])
            if (extraData.length && version < 45)
                version = 45
            this._push([
                4, 0x02014b50, // central dir signature
                2, version,
                2, version,
                2, 0x08, // flags (bit3 = no crc in local header)
                2, 0,    // compression method = store
                ...ts2buf(ts),
                4, crc,
                4, size, // compressed
                4, size,
                2, pathAsBuffer.length,
                2, extraData.length,
                2, 0, //comment length
                2, 0, // disk
                2, 0, // attr
                4, 0, // ext.attr
                4, offset,
            ])
            this._push(pathAsBuffer)
            this._push(extraData)
        }
        const n = this.centralDir.length
        const after = this.dataWritten
        let centralSize = after-centralOffset
        if (centralOffset > ZIP64_LIMIT) {
            this._push([
                4, 0x06064b50, // end of central dir zip64
                8, 44,
                2, 45,
                2, 45,
                4, 0,
                4, 0,
                8, n,
                8, n,
                8, centralSize,
                8, centralOffset,
            ])
            this._push([
                4, 0x07064b50,
                4, 0,
                8, after,
                4, 1,
            ])
            centralOffset = 0xFFFFFFFF
        }
        this._push([
            4,0x06054b50, // end of central directory signature
            4,0, // disk-related stuff
            2,this.numberOfFiles,
            2,this.numberOfFiles,
            4,centralSize,
            4,centralOffset,
            2,0, // comment length
        ])
        this.push(null) // EOF
    }
}

function buffer(parts: any[]) {
    const pairs = []
    let total = 0
    while (parts.length) {
        const size = parts.shift()
        if (typeof size === 'string') {
            pairs.push([String, size])
            total += size.length
        }
        else {
            pairs.push([size, parts.shift()])
            total += size
        }
    }
    const ret = Buffer.alloc(total, 0)
    let offset = 0
    for (const [size, data] of pairs) {
        if (size === 1)
            offset = ret.writeUInt8(data, offset)
        else if (size === 2)
            offset = ret.writeUInt16LE(data, offset)
        else if (size === 4)
            offset = ret.writeUInt32LE(data, offset)
        else if (size === 8)
            offset = ret.writeBigUInt64LE(BigInt(data), offset)
        else if (size === String)
            offset = ret.write(data,'ascii')
        else
            throw 'unsupported'
    }
    return ret
}

function ts2buf(ts:Date) {
    const date = (ts.getFullYear() - 1980) << 9 | ts.getMonth() << 5 | ts.getDate()
    const time = ts.getHours() << 11 | ts.getMinutes() << 5 | ts.getSeconds()
    return [
        2, time,
        2, date,
    ]
}
