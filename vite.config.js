import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function modelNumberFromBase(base) {
  return base.match(/modell(\d+)/i)?.[1] ?? '3'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/modell4/'
  const modelNumber = modelNumberFromBase(base)

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'html-model-title',
        transformIndexHtml(html) {
          return html.replace(
            /<title>.*?<\/title>/,
            `<title>Finanzmodell Hektopascal — Modell ${modelNumber}</title>`,
          )
        },
      },
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts')) {
              return 'charts'
            }
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  }
})
