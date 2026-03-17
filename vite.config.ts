import path from "path"
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const define = {
    'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || process.env.SUPABASE_URL || ''),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''),
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''),
    'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''),
  }

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
          vite: {
            define,
            build: {
              rollupOptions: {
                external: ['bufferutil', 'utf-8-validate'],
              },
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload()
          },
        },
      ]),
      renderer(),
    ],
    define,
    server: {
      port: 5182,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
