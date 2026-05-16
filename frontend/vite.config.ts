import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  server: {
    port: 5173,
    host: true,
    https: true,
    proxy: {
      '/api': {
        target: 'https://backend:5000',
        secure: false,
        changeOrigin: true
      },
      '/ws': {
        target: 'https://backend:5000',
        secure: false,
        ws: true,
        changeOrigin: true
      }
    }
  }
})
