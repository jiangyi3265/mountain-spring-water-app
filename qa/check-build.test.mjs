// 构建产物检查的回归：正式上线包模式必须拦下演示开关、演示接口和缺失的正式接口地址；演示包（非正式模式）不受影响。
// 用临时目录模拟 mp-weixin 产物，以子进程方式运行 check-build.mjs，按真实退出码判断。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const script = join(root, 'qa', 'check-build.mjs')

async function fixture({ header, api }) {
  const dir = await mkdtemp(join(tmpdir(), 'water-check-build-'))
  await cp(join(root, 'static'), join(dir, 'static'), { recursive: true })
  await mkdir(join(dir, 'components'), { recursive: true })
  await writeFile(join(dir, 'components', 'MobileHeader.js'), `"use strict";const e={data:()=>({layout:{},${header}})};exports.default=e;`)
  await writeFile(join(dir, 'common.js'), `"use strict";const API_BASE_URL=${JSON.stringify(api)};exports.API_BASE_URL=API_BASE_URL;`)
  return dir
}
function run(dir, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, 'mp-weixin', dir], { env: { ...process.env, VITE_WATER_DEMO: '', WATER_RELEASE_CHECK: '', ...env }, encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output: stdout }
  } catch (error) {
    return { ok: false, output: String(error.stderr || error.message) }
  }
}

test('正式上线包：演示开关、演示接口、缺失正式接口地址都会失败；干净的正式包通过', async () => {
  const dirs = []
  try {
    const clean = await fixture({ header: 'demo:!1', api: 'https://cang.oksja.cn/api' }); dirs.push(clean)
    assert.equal(run(clean, { WATER_RELEASE_CHECK: '1' }).ok, true)
    const demoBadge = await fixture({ header: 'demo:!0', api: 'https://cang.oksja.cn/api' }); dirs.push(demoBadge)
    const badge = run(demoBadge, { WATER_RELEASE_CHECK: '1' })
    assert.equal(badge.ok, false); assert.match(badge.output, /Demo badge enabled/)
    const showcase = await fixture({ header: 'demo:!1', api: 'https://cang.oksja.cn/showcase/api' }); dirs.push(showcase)
    const demoApi = run(showcase, { WATER_RELEASE_CHECK: '1' })
    assert.equal(demoApi.ok, false); assert.match(demoApi.output, /showcase/)
    const envFlag = run(clean, { WATER_RELEASE_CHECK: '1', VITE_WATER_DEMO: 'true' })
    assert.equal(envFlag.ok, false); assert.match(envFlag.output, /VITE_WATER_DEMO=true/)
    // 演示包不开启正式模式：允许演示开关和演示接口，仍然检查本机接口地址
    assert.equal(run(showcase).ok, true)
    const local = await fixture({ header: 'demo:!1', api: 'http://127.0.0.1:18090/api' }); dirs.push(local)
    assert.equal(run(local).ok, false, 'a local API address always fails')
  } finally {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  }
})
