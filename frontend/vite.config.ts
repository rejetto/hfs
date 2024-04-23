import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        outDir: '../dist/frontend',
        emptyOutDir: true,
        target: "chrome69",
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
        legacy({
            renderModernChunks: false, // single version, legacy one
            polyfills: false, // keeping polyfills at a minimum, manually
            targets: ['firefox 40'],
        }),
    ],
})
