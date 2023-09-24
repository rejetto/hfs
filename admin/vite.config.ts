import { defineConfig } from 'vite'
import vitePluginImport from 'vite-plugin-babel-import';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        outDir: '../dist/admin',
        emptyOutDir: true,
        target: "es2015",
        rollupOptions: {
            plugins: [
                vitePluginImport([
                    { // speed up build process (~2s on my M1) by bringing "modules transformed" from 11k+ down to 1.7k+
                        libraryName: '@mui/icons-material',
                        libraryDirectory: '',
                        libraryChangeCase: "camelCase",
                        ignoreStyles: [],
                    },
                ])
            ],
            onwarn(warning, warn) {
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes(`"use client"`)) return
                warn(warning)
            },
        }
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
