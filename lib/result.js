/**
 * 两个后端返回值的那一份契约：adapter 只交 raw，形状在这里定。
 *
 * 为什么要有这一层：工具的输出 schema、`presentationMeta`、页面上的「共多少条」与测试都从它派生。
 * 后端各写各的时，加一个后端就会悄悄少字段（日期不是 ISO 就是没日期，`ref` 忘了盖章），而那种错
 * 在模型那边只表现成「少一列」——不会报错。
 *
 * 它不查索引、不读配置、不认识任何引擎：只把调用方交来的 raw 变成工具能直接返回的形状。日期由各
 * adapter 自己转成 ISO（这里只校验结果），因为两个索引的时间字段来源不同。
 */

import { formatRef } from './ref.js'

/** 文件名结果的键集合。`total` 会在 0.5.0 进来，现在不加：模型可见的形状这版不许变。 */
const FILES_KEYS = ['items', 'truncated']

/** 内容结果的键集合。 */
const CONTENT_KEYS = ['items', 'total', 'truncated']

/**
 * 契约被破坏时抛的错。
 *
 * 故意不是 `EngineError`：这不是引擎的失败，是我们自己 adapter 的 bug，不该让模型看到「引擎坏了」；
 * 由 `guard` 包成 `LOCAL_SEARCH_ERROR`，同时测试里能被直接钉住。
 * @param {string} message - 哪一条不满足
 */
function contractError(message) {
  return new Error(`local_search_contract: ${message}`)
}

/**
 * 只保留契约里的键，并校验类型。
 *
 * 多余的键直接丢掉而不是透传：透传等于让后端偷偷扩大模型看到的形状，而 schema 会拒收。
 * @param {Record<string, unknown>} raw - adapter 交来的一条
 * @param {string} kind - `files` 或 `content`
 * @returns {{path: string, size?: number, modified?: string}} 干净的条目
 */
function normalizeItem(raw, kind) {
  if (raw === null || typeof raw !== 'object') throw contractError(`${kind} item is not an object`)
  const item = {}
  if (typeof raw.path !== 'string' || raw.path === '') throw contractError(`${kind} item has no path`)
  item.path = raw.path
  if (raw.size !== undefined) {
    if (typeof raw.size !== 'number' || !Number.isFinite(raw.size)) throw contractError('size is not a number')
    item.size = raw.size
  }
  if (raw.modified !== undefined) {
    if (typeof raw.modified !== 'string' || Number.isNaN(Date.parse(raw.modified))) {
      throw contractError('modified is not an ISO date')
    }
    item.modified = raw.modified
  }
  return item
}

/**
 * 内容条目 = 公共字段 + 后端给的 `ref`（还没带引擎前缀，前缀由 {@link contentResult} 盖）。
 * @param {Record<string, unknown>} raw - adapter 交来的一条
 * @returns {{path: string, ref: string, size?: number, modified?: string}} 干净的条目
 */
function normalizeContentItem(raw) {
  const item = normalizeItem(raw, 'content')
  if (typeof raw.ref !== 'string' || raw.ref === '') throw contractError('content item has no ref')
  return { ...item, ref: raw.ref }
}

/**
 * adapter 交来的 raw：顶层字段缺了或类型不对就抛。
 *
 * 这是「坏 raw 直接抛」真正成立的地方。早先的版本在这里静默吸收：`items` 不是数组就当空、
 * `total` 缺失就回落、`truncated` 不是 `true` 就当 false——而这三类恰恰是「换个后端少字段」
 * 的表现，静默吸收等于把契约测试本该挡的故障放到模型面前。
 * @param {unknown} raw - adapter 的返回
 * @param {string} kind - `files` 或 `content`
 * @returns {Record<string, unknown>} 通过顶层检查的 raw
 */
function requireRaw(raw, kind) {
  if (raw === null || typeof raw !== 'object') throw contractError(`${kind} raw is not an object`)
  const value = /** @type {Record<string, unknown>} */ (raw)
  if (!Array.isArray(value.items)) throw contractError(`${kind} raw items is not an array`)
  if (typeof value.truncated !== 'boolean') throw contractError(`${kind} raw truncated is not a boolean`)
  return value
}

/**
 * 文件名结果。
 * @param {object} raw - `{ items, truncated }`（total 留给 0.5.0）
 * @returns {{items: Array<{path: string, size?: number, modified?: string}>, truncated: boolean}} 工具可以直接返回的形状
 */
export function filesResult(raw) {
  const value = requireRaw(raw, 'files')
  return {
    items: /** @type {Array<object>} */ (value.items).map((item) => normalizeItem(item, 'files')),
    truncated: /** @type {boolean} */ (value.truncated),
  }
}

/**
 * 内容结果，并统一盖章 `engine` 与 `ref`。
 *
 * `ref` 带引擎前缀（`anytxt:123`）：模型把它传回来时，我们才知道该问哪个后端。
 * @param {object} raw - `{ items, total, truncated }`
 * @param {{engine?: string}} [options] - 这个 adapter 属于哪个后端；缺了在这里报契约错
 * @returns {{items: Array<{path: string, ref: string, size?: number, modified?: string}>, total: number, truncated: boolean}} 工具可以直接返回的形状
 */
export function contentResult(raw, { engine } = {}) {
  if (typeof engine !== 'string' || engine === '') throw contractError('content result needs an engine name')
  const value = requireRaw(raw, 'content')
  if (!Number.isInteger(value.total) || /** @type {number} */ (value.total) < 0) {
    throw contractError('content raw total is not a count')
  }
  const items = /** @type {Array<object>} */ (value.items).map(normalizeContentItem)
  return {
    items: items.map((item) => ({ ...item, engine, ref: formatRef(engine, item.ref) })),
    total: /** @type {number} */ (value.total),
    truncated: /** @type {boolean} */ (value.truncated),
  }
}

/**
 * 断言一份结果符合契约。构造器自己已经保证了形状，所以它只在测试（以及将来接手的构造器）里用。
 * @param {object} value - 要检查的结果
 * @param {string} kind - `files` 或 `content`
 */
export function assertShape(value, kind) {
  if (value === null || typeof value !== 'object') throw contractError(`${kind} result is not an object`)
  const keys = kind === 'content' ? CONTENT_KEYS : FILES_KEYS
  const extra = Object.keys(value).filter((key) => !keys.includes(key))
  if (extra.length > 0) throw contractError(`${kind} result has extra keys: ${extra.join(', ')}`)
  for (const key of keys) {
    if (!(key in value)) throw contractError(`${kind} result is missing ${key}`)
  }
  if (!Array.isArray(value.items)) throw contractError(`${kind} items is not an array`)
  if (typeof value.truncated !== 'boolean') throw contractError(`${kind} truncated is not a boolean`)
  if (kind === 'content') {
    if (!Number.isInteger(value.total) || value.total < 0) throw contractError('content total is not a count')
    for (const item of value.items) {
      if (typeof item.engine !== 'string' || item.engine === '') throw contractError('content item has no engine')
      if (typeof item.ref !== 'string' || !item.ref.startsWith(`${item.engine}:`)) {
        throw contractError('content item ref is not engine-prefixed')
      }
    }
  }
}
