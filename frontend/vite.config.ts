import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import preact from '@preact/preset-vite'

// https://vitejs.dev/config/
export default defineConfig(async () => {
    const Sonda = process.env.BUNDLE_REPORT ? (await import('sonda/vite')).default : null
    return {
        build: {
            outDir: '../dist/frontend',
            emptyOutDir: true,
            sourcemap: Boolean(Sonda),
            //target: "chrome69",
        },
        resolve: {
            alias: {
                'react': 'preact/compat',
                'react-dom': 'preact/compat',
                'react-dom/test-utils': 'preact/test-utils',
                'react/jsx-runtime': 'preact/jsx-runtime',
            },
        },
        server: {
            port: 3005,
            host: '127.0.0.1',
            proxy: {
                '/~/': {
                    target: 'http://localhost',
                    proxyTimeout: 2000,
                    changeOrigin: true,
                    ws: true,
                }
            }
        },
        plugins: [
            preact(),
            legacy({
                renderModernChunks: false, // single version, legacy one
                polyfills: false, // keeping polyfills at a minimum, manually
                targets: ['firefox 40', 'chrome 69'],
            }),
            ... Sonda ? [Sonda({ detailed: true, gzip: true, brotli: true })] : [],
        ],
    }
})
