import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5102, strictPort: true },
  preview: { port: 5102, strictPort: true },
})
