import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'

// 用法：node qa/check-build.mjs <h5|mp-weixin> [输出目录]
// 输出目录缺省为 dist/build/<平台>；使用 --outDir 构建时必须传入同一目录，否则检查的是旧产物。
// WATER_RELEASE_CHECK=1 时按“正式上线包”检查：不得打开演示开关（VITE_WATER_DEMO），不得指向演示接口 /showcase/api，
// 接口地址须为 WATER_RELEASE_API_BASE（缺省 https://cang.oksja.cn/api）。演示包不设该变量，不受影响。
const platform = process.argv[2]
if (!['h5', 'mp-weixin'].includes(platform)) throw new Error('Expected h5 or mp-weixin')
const root = resolve(import.meta.dirname, '..')
const output = process.argv[3] ? resolve(process.argv[3]) : join(root, 'dist/build', platform)
const release = process.env.WATER_RELEASE_CHECK === '1'
const releaseApiBase = (process.env.WATER_RELEASE_API_BASE || 'https://cang.oksja.cn/api').replace(/\/$/, '')
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat()
}
const failures = []
if (!(await stat(output).catch(() => null))?.isDirectory()) {
  // npm 的 postbuild 拿不到 --outDir：用自定义目录构建时默认目录可能不存在，此时跳过，由调用方传入实际目录再检查
  if (!process.argv[3]) { console.log(`${platform}: default output ${relative(root, output)} not found; built elsewhere — run check-build with the actual --outDir`); process.exit(0) }
  throw new Error(`Build output not found: ${output}`)
}
for (const source of await files(join(root, 'static'))) {
  const target = join(output, relative(root, source))
  if (!(await stat(target).catch(() => null))?.isFile()) failures.push(`Missing static asset: ${relative(root, source)}`)
}
let apiBaseFound = false
for (const file of await files(output)) {
  if (!file.endsWith('.js')) continue
  const code = await readFile(file, 'utf8')
  if (/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\/api\b/.test(code)) {
    failures.push(`Local API address in production bundle: ${relative(output, file)}`)
  }
  if (!release) continue
  if (code.includes('/showcase/api')) failures.push(`Demo (showcase) API address in release bundle: ${relative(output, file)}`)
  if (code.includes(releaseApiBase)) apiBaseFound = true
  // 小程序产物中顶栏组件单独成文件：演示开关编译为 demo:!0
  if (platform === 'mp-weixin' && /components[\\/]MobileHeader\.js$/.test(file) && /\bdemo:\s*(?:!0|true)\b/.test(code)) failures.push('Demo badge enabled in release bundle (components/MobileHeader.js)')
}
if (release) {
  if (process.env.VITE_WATER_DEMO === 'true') failures.push('VITE_WATER_DEMO=true in the release build environment')
  for (const name of (await readdir(root)).filter(item => /^\.env/.test(item) && item !== '.env.example')) {
    if (/^\s*VITE_WATER_DEMO\s*=\s*['"]?true/m.test(await readFile(join(root, name), 'utf8'))) failures.push(`VITE_WATER_DEMO=true in ${name}`)
  }
  if (!apiBaseFound) failures.push(`Release API base ${releaseApiBase} not found in bundle`)
}
if (failures.length) throw new Error(failures.join('\n'))
console.log(`${platform}: static assets present; no local API address in production bundle${release ? `; release checks passed (API ${releaseApiBase}, demo off)` : ''} [${relative(root, output) || output}]`)
