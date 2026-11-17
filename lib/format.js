/**
 * 面向模型的格式化。结果始终有界：调用方在这些函数跑起来之前就把条目数与文本量卡好了。
 */

import { engineLabel } from './labels.js'
import { MAX_LIMIT } from './limits.js'
import { isFailure } from './status.js'

function sizeSuffix(size) {
  return typeof size === 'number' && Number.isFinite(size) ? `\t${size} B` : ''
}

function modifiedSuffix(modified) {
  return typeof modified === 'string' && modified.length > 0 ? `\t${modified}` : ''
}

/** 只在到顶时补一句：没到顶时 header 的 `5 of 205` 已经说明还有更多。 */
function contentMore(shown) {
  return shown >= MAX_LIMIT
    ? `\n\n(max ${MAX_LIMIT} shown; narrow query/path/ext.)`
    : ''
}

/** 文件名结果没有总数，截断时仍提示可以加 limit。 */
function filesMore(shown) {
  return shown >= MAX_LIMIT
    ? `\n\n(max ${MAX_LIMIT} shown; narrow query.)`
    : `\n\n(raise limit or narrow query.)`
}

/** 格式化文件名结果（Everything）。 */
export function formatFiles(value) {
  const items = Array.isArray(value.items) ? value.items : []
  if (items.length === 0) {
    // 上限先于排除过滤生效，所以空窗口仍可能意味着「本来还有更多」：要说清楚，而不是干巴巴
    // 一句 "no files found"。
    return value.truncated
      ? 'No files found in the returned window (raise limit or narrow query).'
      : 'No files found.'
  }
  const header = value.truncated
    ? `Found ${items.length} path(s) (capped)`
    : `Found ${items.length} path(s)`
  const body = items
    .map((item) => `${item.path}${sizeSuffix(item.size)}${modifiedSuffix(item.modified)}`)
    .join('\n')
  const footer = value.truncated ? filesMore(items.length) : ''
  return `${header}\n\n${body}${footer}`
}

/** 格式化内容结果（Anytxt）。 */
export function formatContent(value) {
  const items = Array.isArray(value.items) ? value.items : []
  // 退回 workspace / 跳过缺失的根都是结果事实，不是错误：一行说清楚，别让结果悄悄变少。
  const notes = []
  if (value.scopeFallback) notes.push('scope=all found no available root; searched the workspace instead.')
  if (Array.isArray(value.scopeMissing) && value.scopeMissing.length > 0) {
    notes.push(`skipped configured root(s) that do not exist: ${value.scopeMissing.join(', ')}`)
  }
  const fallback = notes.length > 0 ? `\n\n(${notes.join(' ')})` : ''
  if (items.length === 0) return `No content matches for this query.${fallback}`
  const header = `${items.length} of ${value.total ?? items.length} matching file(s)`
  const body = items.map((item) => `${item.ref}\t${item.path}`).join('\n')
  const footer = value.truncated ? contentMore(items.length) : ''
  return `${header}\n\n${body}${footer}${fallback}`
}

/** 格式化一个已索引文档的片段。 */
export function formatFragments(value) {
  const fragments = Array.isArray(value.fragments) ? value.fragments.filter(Boolean) : []
  return fragments.length > 0 ? fragments.join('\n---\n') : 'No fragments returned.'
}

/** 格式化一段文档摘录，并带上它的总长度。 */
export function formatRead(value) {
  const total = typeof value.totalChars === 'number' ? value.totalChars : 0
  const offset = typeof value.offset === 'number' ? value.offset : 0
  const returned = typeof value.returned === 'number' ? value.returned : 0
  if (returned === 0) return `chars ${total}; nothing to show at offset ${offset}`
  // 终点是闭区间，读的人才能直接拿两个数相减。
  return `chars ${total}; showing ${offset}..${offset + returned - 1}\n\n${value.text ?? ''}`
}

/**
 * 一个引擎的状态行。
 *
 * 探测被取消说明这次调用被中止了，不是索引不可用——报成 DOWN 会让人去查错的问题。
 * @param {string} label - 引擎标签
 * @param {object} status - 探测结果
 * @param {(status: object) => string} okDetail - 引擎正常时追加的后缀
 * @returns {string} 这一行
 */
function engineLine(label, status, okDetail) {
  if (status.ok) return `${label}: OK${okDetail(status)}`
  // 跳过与取消不是故障：报成 DOWN 会让人去查错的问题。
  if (!isFailure(status)) {
    if (status.code === 'SKIPPED') return `${label}: SKIPPED${status.message ? ` — ${status.message}` : ''}`
    return `${label}: ABORTED — ${status.code}`
  }
  return `${label}: DOWN — ${status.code ?? 'UNKNOWN'}${status.message ? `: ${status.message}` : ''}`
}

/** 正常时补充的定位：版本、路径或地址，有什么写什么。 */
function okDetail(status) {
  const version = status.version ? ` (${status.version})` : ''
  const where = status.path ? ` via ${status.path}` : status.url ? ` at ${status.url}` : ''
  return `${version}${where}`
}

/**
 * 格式化注册表里每个后端的状态，再附上配置的根。
 *
 * 注册表由调用方传进来（`tools.js` 本来就有）：`format.js` 只做输出，不 import 注册表，否则会
 * 形成 `everything.js → format.js → engines.js → everything.js` 的环。输出顺序由 `entries` 定。
 * @param {object} value - `{ engines: {<id>: status}, roots }`
 * @param {{entries: Array<{id: string, kind: string}>, names: {files: string[], content: string[]}}} registries - 注册表视图
 * @returns {string} 多行状态
 */
export function formatStatus(value, registries) {
  const statuses = value.engines ?? {}
  const entries = registries.entries
  const lines = entries.map(({ id }) => engineLine(engineLabel(id), statuses[id] ?? {}, okDetail))
  const roots = value.roots ?? {}
  lines.push(`workspace=${roots.workspace ?? ''}`)
  lines.push(`work=${roots.work ?? ''}`)
  lines.push(`personal=${roots.personal ?? ''}`)
  lines.push(`all=${Array.isArray(roots.all) ? roots.all.join(',') : ''}`)
  // 配置的根全部不在时，`all` 实际会退回 workspace；这一行让模型看到的是真实行为。
  if (roots.allFallback) lines.push('allFallback=workspace')
  if (Array.isArray(roots.allMissing) && roots.allMissing.length > 0) {
    lines.push(`allMissing=${roots.allMissing.join(',')}`)
  }
  lines.push(`default=${roots.default ?? ''}`)
  const names = registries.names
  lines.push(`engines=files:${names.files.join(',')} content:${names.content.join(',')}`)
  return lines.join('\n')
}
