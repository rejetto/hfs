import { defineConfig } from 'vite'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const ICONS_MODULE = '@mui/icons-material'
const TYPE_EXPORTS = new Set(['SvgIconComponent'])
const ICON_IMPORT_RE = /import\s*{\s*([^}]+?)\s*}\s*from\s*['"]@mui\/icons-material['"];?/gs

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        outDir: '../dist/admin',
        emptyOutDir: true,
        target: "es2015",
        rollupOptions: {
            onwarn(warning, warn) {
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes(`"use client"`)) return
                warn(warning)
            },
        }
    },
    plugins: [
        muiIconsDeepImportPlugin(),
    ],
    optimizeDeps: {
        exclude: [ICONS_MODULE],
        // optimizeDeps scans before plugins, so workspace barrel imports need explicit deep entries
        include: getMuiIconImports().map(name => `${ICONS_MODULE}/${name}`),
    },
    server: {
        port: 3006,
        host: '127.0.0.1',
        proxy: {
            '/~/': {
                target: 'http://localhost',
                proxyTimeout: 2000,
                changeOrigin: true,
                ws: true,
            }
        }
    }
})

function muiIconsDeepImportPlugin() {
    return {
        name: 'mui-icons-deep-import',
        enforce: 'pre' as const,
        transform(code: string, id: string) {
            if (!/\.[jt]sx?$/.test(id) || !code.includes(ICONS_MODULE))
                return
            // deep imports keep Vite from pre-bundling the full icons barrel
            const replaced = code.replace(ICON_IMPORT_RE, (full, specifiers) => {
                const imports = specifiers.split(',')
                    .map(x => x.trim())
                    .filter(Boolean)
                    .map(parseSpecifier)
                const typeImports = imports.filter(x => TYPE_EXPORTS.has(x.imported))
                const valueImports = imports.filter(x => !TYPE_EXPORTS.has(x.imported))
                return [
                    ...typeImports.length ? [`import type { ${typeImports.map(formatTypeImport).join(', ')} } from '${ICONS_MODULE}'`] : [],
                    ...valueImports.map(({ imported, local }) => `import ${local} from '${ICONS_MODULE}/${imported}'`),
                ].join('\n')
            })
            return replaced === code ? undefined : { code: replaced, map: null }
        },
    }

    function parseSpecifier(specifier: string) {
        const [imported, local = imported] = specifier.split(/\s+as\s+/)
        return { imported: imported.trim(), local: local.trim() }
    }

    function formatTypeImport({ imported, local }: ReturnType<typeof parseSpecifier>) {
        return local === imported ? imported : `${imported} as ${local}`
    }
}

function getMuiIconImports() {
    const icons = new Set<string>()
    for (const dir of ['src', '../mui-grid-form'])
        scan(resolve(DIR, dir))
    return [...icons].sort()

    function scan(path: string) {
        const stat = statSync(path)
        if (stat.isDirectory()) {
            for (const name of readdirSync(path))
                scan(resolve(path, name))
            return
        }
        if (!['.js', '.jsx', '.ts', '.tsx'].includes(extname(path)))
            return
        for (const match of readFileSync(path, 'utf8').matchAll(ICON_IMPORT_RE)) {
            for (const specifier of match[1].split(',')) {
                const imported = specifier.trim().split(/\s+as\s+/)[0]
                if (imported && !TYPE_EXPORTS.has(imported))
                    icons.add(imported)
            }
        }
    }
}
