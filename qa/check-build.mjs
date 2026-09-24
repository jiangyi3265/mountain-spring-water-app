import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'

const platform = process.argv[2]
if (!['h5', 'mp-weixin'].includes(platform)) throw new Error('Expected h5 or mp-weixin')
const root = resolve(import.meta.dirname, '..')
const output = join(root, 'dist/build', platform)
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat()
}
const failures = []
for (const source of await files(join(root, 'static'))) {
  const target = join(output, relative(root, source))
  if (!(await stat(target).catch(() => null))?.isFile()) failures.push(`Missing static asset: ${relative(root, source)}`)
}
for (const file of await files(output)) {
  if (!file.endsWith('.js')) continue
  const code = await readFile(file, 'utf8')
  if (/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\/api\b/.test(code)) {
    failures.push(`Local API address in production bundle: ${relative(output, file)}`)
  }
}
if (failures.length) throw new Error(failures.join('\n'))
console.log(`${platform}: static assets present; no local API address in production bundle`)
