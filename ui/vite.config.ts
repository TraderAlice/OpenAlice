import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev server on port 5173 with API proxy to the backend (port 3002).
  // Use this during development for hot reload. See README for details.
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
})
