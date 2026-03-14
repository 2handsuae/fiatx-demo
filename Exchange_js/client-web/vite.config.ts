import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.DEV_SERVER_PORT || '3502')

  return {
    plugins: [react()],
    server: {
      port,
    },
  }
})
