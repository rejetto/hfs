import { expect, test } from '@playwright/test'
import { getId3Tags } from '../frontend/src/id3'

test('ID3 text fields stop at their terminator', async () => {
    const text = Buffer.from('\0Visible title\0Hidden suffix', 'latin1')
    const tag = Buffer.alloc(20 + text.length)
    tag.write('ID3', 0, 'ascii')
    tag[3] = 3
    tag[9] = tag.length - 10
    tag.write('TIT2', 10, 'ascii')
    tag.writeUInt32BE(text.length, 14)
    text.copy(tag, 20)

    const tags = await getId3Tags(`data:audio/mpeg;base64,${tag.toString('base64')}`)
    expect(tags?.title).toBe('Visible title')
})

test('ID3v2.4 text frames are decoded', async () => {
    const title = Buffer.alloc(140)
    title.write('TIT2', 0, 'ascii')
    title.set([0, 0, 1, 2], 4) // 130-byte payload as a syncsafe integer
    title[10] = 3 // UTF-8
    title.fill('T', 11)
    const year = Buffer.alloc(15)
    year.write('TDRC', 0, 'ascii')
    year[7] = 5
    year[10] = 3
    year.write('2026', 11, 'utf8')
    const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 1, 27])

    const tag = Buffer.concat([header, title, year])
    const tags = await getId3Tags(`data:audio/mpeg;base64,${tag.toString('base64')}`)
    expect(tags?.title).toBe('T'.repeat(129))
    expect(tags?.year).toBe('2026')
})
