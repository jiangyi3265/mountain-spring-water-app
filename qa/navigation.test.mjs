import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { navigationMetrics } from '../services/navigation.js'

for (const [name, status, width, top, height, left] of [
  ['Android', 24, 375, 30, 32, 278],
  ['iPhone 刘海屏', 44, 390, 50, 32, 293],
  ['iPhone 灵动岛', 59, 393, 65, 32, 296],
  ['小屏紧凑胶囊', 20, 320, 24, 32, 225],
]) {
  test(`${name} 标题中心与真实胶囊对齐，并留出右侧空间`, () => {
    const metrics = navigationMetrics({ statusBarHeight: status, windowWidth: width }, { top, height, left }, true)
    assert.equal(metrics.statusHeight + metrics.navHeight / 2, top + height / 2)
    assert.equal(metrics.headerHeight, status + metrics.navHeight)
    assert.ok(width - metrics.sideWidth <= left - 8)
  })
}

test('H5不绘制假的系统状态栏，API缺失或胶囊异常时保留安全间距', () => {
  assert.deepEqual(navigationMetrics(), { statusHeight: 0, navHeight: 44, headerHeight: 44, sideWidth: 52 })
  assert.equal(navigationMetrics({}, null, true).headerHeight, 64)
  assert.equal(navigationMetrics({ statusBarHeight: 0 }, null, true).headerHeight, 44)
  assert.equal(navigationMetrics({ statusBarHeight: 44 }, { top: 0, height: 0, left: 0 }, true).headerHeight, 88)
  const source = readFileSync(new URL('../components/MobileHeader.vue', import.meta.url), 'utf8')
  const template = source.split('</template>')[0]
  assert.doesNotMatch(template, /9:41|status-icons|capsule-line|•••|▮/)
  assert.match(source, /getMenuButtonBoundingClientRect/)
  assert.match(source, /offWindowResize/)
})
