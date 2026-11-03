import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { resolve } from 'node:path'

// Uni's Windows static-file watcher compares absolute paths. A relative '.'
// input root silently skips static assets even when compilation succeeds.
process.env.UNI_INPUT_DIR = resolve(process.env.UNI_INPUT_DIR || '.')

export default defineConfig({
  plugins: [uni(), {
    name: 'non-blocking-optional-auth-sdk',
    // uni's H5 development plugin can detect its own bundled facial API and
    // inject this unused SDK. A slow optional provider must not block app boot.
    transformIndexHtml: {
      order: 'post',
      handler: html => html.replace(/<script\s+src="(https:\/\/cn-shanghai-aliyun-cloudauth\.oss-cn-shanghai\.aliyuncs\.com\/web_sdk_js\/jsvm_all\.js)"\s*>/g, '<script async src="$1">'),
    },
  }],
  server: { host: '127.0.0.1', open: false }
})
