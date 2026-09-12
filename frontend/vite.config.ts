import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Бэкенд не поднят — vite по умолчанию отвечает 500, и клиент
        // принимает это за настоящую ошибку сервера. Отдаём 502: по нему
        // клиент понимает, что бэкенда нет, и считает локально.
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (!('writeHead' in response) || response.headersSent) return
            response.writeHead(502, { 'Content-Type': 'application/json' })
            response.end('{"detail":"Бэкенд не отвечает"}')
          })
        },
      },
    },
  },
  build: {
    // Cesium крупный; разносим его в отдельный чанк, чтобы приложение
    // не перезагружалось целиком при правках нашего кода
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/cesium')) return 'cesium'
          if (id.includes('node_modules/@mantine')) return 'mantine'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler'))
            return 'react'
        },
      },
    },
    chunkSizeWarningLimit: 6000,
  },
})
