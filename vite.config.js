import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { resolve } from 'node:path'

// Uni's Windows static-file watcher compares absolute paths. A relative '.'
// input root silently skips static assets even when compilation succeeds.
process.env.UNI_INPUT_DIR = resolve(process.env.UNI_INPUT_DIR || '.')

export default defineConfig({
  plugins: [uni()],
  server: { host: '127.0.0.1', open: false }
})
