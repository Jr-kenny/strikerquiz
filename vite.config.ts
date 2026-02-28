import devServer from '@hono/vite-dev-server'
import { defaultOptions } from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    devServer({
      adapter,
      entry: 'src/index.tsx',
      // Let Hono handle only /api/* in dev; Vite serves the UI at /
      exclude: [/^\/(?!api(?:\/|$)).*/, ...defaultOptions.exclude]
    })
  ],
  build: {
    outDir: 'dist'
  }
})
