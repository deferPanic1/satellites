import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    proxy: {
      // Используется только в сборке с VITE_API_MODE=remote.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
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
