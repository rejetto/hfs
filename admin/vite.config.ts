import { defineConfig } from 'vite'
import vitePluginImport from 'vite-plugin-babel-import';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        outDir: '../dist/admin',
        emptyOutDir: true,
        target: "es2015",
    },
    plugins: [
        vitePluginImport([
            { // this is (currently) speeding up build process, by bringing "modules transformed" from 11k+ down to 1.5k+
                libraryName: '@mui/icons-material',
                libraryDirectory: '',
                libraryChangeCase: "camelCase",
                ignoreStyles: [],
            },
        ])
    ],
    server: {
        port: 3006,
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
