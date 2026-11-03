import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const out = process.env.QA_EVIDENCE_DIR ? resolve(process.env.QA_EVIDENCE_DIR, 'order-pagination-check') : fileURLToPath(new URL('../../.qa-runtime/order-pagination-20260928/', import.meta.url))
await mkdir(out, { recursive: true })
const paths = ['pages/delivery/index.vue', 'pages/order/index.vue', 'services/waterApi.js', 'qa/order-pagination.test.mjs', 'qa/order-pagination-api.test.mjs', 'qa/order-pagination-harness.mjs', 'qa/order-pagination-fixture.mjs', 'qa/order-pagination-browser.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex') ])))
const report = { scope: 'F03/F07/customer order pagination only, not full project acceptance', startedAt: new Date().toISOString(), node: process.version, sourceBefore: await hashes(), checks: [] }
const commands = [
  ['regression', ['--test', 'qa/order-pagination.test.mjs', 'qa/order-pagination-api.test.mjs', 'qa/logout-contract.test.mjs', 'qa/checkout-regression.test.mjs', 'qa/payment-platform.test.mjs']],
  ['lint', ['node_modules/eslint/bin/eslint.js', 'pages/delivery/index.vue', 'pages/order/index.vue', 'services/waterApi.js']],
  ['typecheck', ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit', '--pretty', 'false']],
]
if (process.argv.includes('--browser')) commands.push(['browser', ['qa/order-pagination-browser.mjs']])
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString()
  const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 180000 })
  const log = `${out}/${name}-final.log`
  await writeFile(log, `${run.stdout || ''}\n${run.stderr || ''}${run.error ? `\n${run.error.stack}` : ''}`)
  report.checks.push({ name, command: `node ${args.join(' ')}`, cwd, startedAt, finishedAt: new Date().toISOString(), exitCode: run.status, log, error: run.error?.message })
  console.log(`${name}: ${run.status === 0 ? 'PASS' : 'FAIL'} (exit ${run.status}) ${log}`)
}
report.sourceAfter = await hashes()
report.sourceUnchangedDuringChecks = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter)
report.finishedAt = new Date().toISOString()
report.status = report.sourceUnchangedDuringChecks && report.checks.every(check => check.exitCode === 0) ? 'PASS' : 'FAIL'
report.browserIncluded = process.argv.includes('--browser')
report.backendSourceSha256 = createHash('sha256').update(await readFile(new URL('../../water-api/server.mjs', import.meta.url))).digest('hex')
await writeFile(`${out}/checks-report.json`, JSON.stringify(report, null, 2))
process.exitCode = report.status === 'PASS' ? 0 : 1
