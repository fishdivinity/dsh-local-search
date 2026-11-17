/**
 * Config schema 的默认值、volatile 与退役键。
 *
 * 直接读生产 `Config`，不重建一份 schema：重建版即使 `schema.js` 把默认值写错也会绿，测的就只剩
 * 字段表本身。0.3.0 的「首启把默认值写进用户层」正是从「schema 无测试」这条缝里过去的。
 *
 * 代价：`.dict` / `.meta` 是 schemastery 的实现结构，不是契约。版本由 lockfile 固定；升级
 * schemastery 时先跑这个测试，形状变了就改断言，别绕过它。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/schema.js'
import { DEFAULTS, RETIRED_PATHS } from '../lib/config.js'
import { FIELDS } from '../lib/fields.js'
import { describeConfig } from '../lib/describe.js'

/**
 * schema 树的叶子：`files.everything.esPath` → 节点（`.meta` 里有 default / volatile / hidden）。
 * @param {object} node - schemastery 节点
 * @param {string[]} [prefix] - 路径前缀
 * @param {Map<string, object>} [found] - 收集结果
 * @returns {Map<string, object>} 叶子表
 */
function leavesOf(node, prefix = [], found = new Map()) {
  for (const [key, child] of Object.entries(node.dict ?? {})) {
    const path = [...prefix, key]
    if (child.dict !== undefined) leavesOf(child, path, found)
    else found.set(path.join('.'), child)
  }
  return found
}

/**
 * 把 DEFAULTS 摊平成「点分路径 → 值」。
 * @param {unknown} value - 配置值
 * @param {string[]} [prefix] - 路径前缀
 * @param {Record<string, unknown>} [out] - 收集结果
 * @returns {Record<string, unknown>} 扁平表
 */
function flatten(value, prefix = [], out = {}) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const path = [...prefix, key]
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, out)
    else out[path.join('.')] = child
  }
  return out
}

/**
 * describe 载荷里的两类路径：页面渲染的字段，与「保存/重置会写的路径」。
 *
 * 两者不同源：`reset.marker`（`autoConfigured`）是隐藏字段，页面不渲染，但重置要写它；把两者
 * 混成一个集合，会把合法的隐藏写回判成「隐藏字段被渲染」。
 * @returns {{rendered: Set<string>, written: Set<string>}} 点分路径
 */
function describedPaths() {
  const payload = describeConfig()
  const rendered = new Set()
  for (const section of payload.sections) {
    if (Array.isArray(section.backendPath)) rendered.add(section.backendPath.join('.'))
    for (const field of section.fields) rendered.add(field.path.join('.'))
  }
  const written = new Set(rendered)
  for (const path of payload.reset.clear) written.add(path.join('.'))
  written.add(payload.reset.marker.join('.'))
  for (const fill of payload.reset.fills) written.add(fill.path.join('.'))
  return { rendered, written }
}

test('every DEFAULTS path keeps its value as the schema default', () => {
  const leaves = leavesOf(Config)
  for (const [path, value] of Object.entries(flatten(DEFAULTS))) {
    const leaf = leaves.get(path)
    assert.ok(leaf !== undefined, `schema is missing ${path}`)
    // 逐键比较：整体 deepEqual 失败时报错只给一棵大树，看不出是哪一条漂了。
    assert.deepEqual(leaf.meta?.default, value, `${path} default drifts from DEFAULTS`)
  }
  // 没有声明之外的叶子：schema 有、字段表没有，说明有一份手写字段漏进了 schema。
  const declared = new Set([
    ...FIELDS.map((field) => field.path.join('.')),
    ...RETIRED_PATHS.map((entry) => entry.from.join('.')),
    'timeoutMs',
  ])
  const orphans = [...leaves.keys()].filter((path) => !declared.has(path)).sort()
  assert.deepEqual(orphans, [], 'schema declares paths that no table knows about')
})

test('every field the page renders is volatile, and timeoutMs is neither volatile nor rendered', () => {
  const leaves = leavesOf(Config)
  for (const field of FIELDS) {
    const path = field.path.join('.')
    const leaf = leaves.get(path)
    assert.ok(leaf !== undefined, `schema is missing ${path}`)
    // 页面保存走 settings；settings 只写 volatile 路径。hidden 的 autoConfigured 也必须是 volatile，
    // 否则首用写回与「重置」都写不进去。
    assert.equal(leaf.meta?.volatile, true, `${path} must be volatile`)
  }
  // 反向：describe 会写的每条路径都得能在 schema 里找到 volatile 叶子。
  const { rendered, written } = describedPaths()
  for (const path of written) {
    const leaf = leaves.get(path)
    assert.ok(leaf !== undefined, `describe writes ${path} but schema has no leaf`)
    assert.equal(leaf.meta?.volatile, true, `${path} is written but not volatile`)
  }
  // 截止时间是注册时固定的：既不 volatile，也不该出现在页面里。
  assert.ok(!rendered.has('timeoutMs'))
  assert.ok(!written.has('timeoutMs'))
  assert.notEqual(leaves.get('timeoutMs')?.meta?.volatile, true)
})

test('retired paths stay hidden and undescribed while their targets stay visible', () => {
  const leaves = leavesOf(Config)
  const { rendered, written } = describedPaths()
  for (const { from, to } of RETIRED_PATHS) {
    const key = from.join('.')
    const target = to.join('.')
    const leaf = leaves.get(key)
    // 必须留在 schema 里：settings 只允许撤 schema 里有的路径，迁移靠它清旧键。
    assert.ok(leaf !== undefined, `${key} must stay in the schema`)
    assert.equal(leaf.meta?.hidden, true, `${key} must stay hidden`)
    assert.equal(leaf.meta?.volatile, true, `${key} must be volatile so it can be unset`)
    assert.match(String(leaf.meta?.description), new RegExp(`moved to ${target.replace(/\./g, '\\.')}`))
    assert.ok(!rendered.has(key), `${key} must not be rendered`)
    assert.ok(!written.has(key), `${key} must not be written by the page`)
    assert.ok(leaves.get(target) !== undefined, `target ${target} is missing`)
    const field = FIELDS.find((entry) => entry.path.join('.') === target)
    if (field !== undefined && field.hidden !== true) {
      assert.ok(rendered.has(target), `visible target ${target} should be rendered`)
    }
  }
  // 隐藏字段（autoConfigured）同理：在 schema 里，可写，但页面不渲染它。
  for (const field of FIELDS.filter((entry) => entry.hidden === true)) {
    assert.ok(!rendered.has(field.path.join('.')), `${field.path.join('.')} is hidden but rendered`)
  }
})
