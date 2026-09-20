import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { posix, resolve, win32 } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('filesystem ancestor searches stop at unavailable roots', async () => {
    for (const [paths, root] of [
        [win32, 'Z:\\'],
        [win32, '\\\\server\\share'],
        [win32, '\\\\server\\share\\'],
        [posix, '/'],
    ] as const) {
        let calls = 0
        let available = ''
        const exists = (path: string) => {
            assert.ok(++calls < 10, `ancestor search did not stop: ${path}`)
            return path === available
        }
        const statfs = (path: string) => {
            assert.ok(available, 'unavailable root reached statfs')
            assert.equal(path, available)
            return { bavail: 2, bsize: 4, blocks: 3 }
        }
        const modules: Record<string, unknown> = {
            path: paths,
            fs: { existsSync: exists, statfsSync: statfs },
            'node:fs/promises': { statfs: async (path: string) => statfs(path) },
            './misc': { exists, isDirectory: exists, isWindowsDrive: (path: string) => /^[a-zA-Z]:$/.test(path) },
            './const': { IS_WINDOWS: false },
        }
        const disk = load('util-os') as typeof import('../src/util-os')
        modules['./util-os'] = disk
        const api = (load('api.vfs') as typeof import('../src/api.vfs')).default
        for (const path of [root, paths.join(root, 'missing', 'child')]) {
            calls = 0
            assert.throws(() => disk.getDiskSpaceSync(path), /unavailable root reached statfs/)
            calls = 0
            await assert.rejects(disk.getDiskSpace(path), /unavailable root reached statfs/)
            calls = 0
            const result = await api.resolve_path({ path, closestFolder: true })
            assert.equal(paths.dirname(result.path), result.path)
            assert.equal(result.isFolder, false)
        }
        available = paths.join(root, 'existing')
        const path = paths.join(available, 'missing')
        calls = 0
        assert.equal(disk.getDiskSpaceSync(path).name, available)
        calls = 0
        assert.equal((await disk.getDiskSpace(path)).name, available)
        calls = 0
        const result = await api.resolve_path({ path, closestFolder: true })
        assert.equal(result.path, available)
        assert.equal(result.isFolder, true)

        function load(name: string) {
            const source = readFileSync(resolve(__dirname, `../src/${name}.ts`), 'utf8')
            const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
            const exports = {}
            // isolate filesystem failures and Windows path semantics without starting HFS
            runInNewContext(outputText, { exports, require: (id: string) => modules[id] || {} })
            return exports
        }
    }
})

test('folder upload stops at the first created directory on Windows, including share and drive roots', () => {
    const source = readFileSync(resolve(__dirname, '../src/upload.ts'), 'utf8')
    // exercise the actual ownership walk with Windows mkdir results without requiring a Windows filesystem
    const block = source.slice(source.indexOf('const createdFolders:'), source.indexOf('// use temporary name while uploading'))
    assert.ok(block.includes('mkdirSync'))
    const { outputText } = ts.transpileModule(block + '\nJSON.stringify(createdFolders)', {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    })
    for (const root of ['C:\\', '\\\\server\\share\\', 'C:\\existing', '\\\\server\\share\\existing']) {
        for (const namespaced of [false, true]) {
            const first = win32.join(root, 'new')
            for (const dir of [first, win32.join(first, 'nested')]) {
                let steps = 0
                const result = JSON.parse(runInNewContext(outputText, {
                    ...win32, posix, dir, vfsUri: '/new/' + (dir === first ? '' : 'nested/') + 'file.txt', ctx: {},
                    fs: { mkdirSync: () => namespaced ? win32.toNamespacedPath(first) : first },
                    setUploadMeta() {},
                    dirname(path: string) {
                        assert.ok(++steps < 10, 'upload ownership walk did not stop')
                        return win32.dirname(path)
                    },
                }, { timeout: 1000 }))
                assert.deepEqual(result, dir === first ? [{ uri: '/new', source: first }] : [
                    { uri: '/new/nested', source: dir }, { uri: '/new', source: first },
                ])
            }
        }
    }
})
