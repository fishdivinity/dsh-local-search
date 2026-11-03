import test from 'node:test'
import assert from 'node:assert/strict'
import { filetimeToIso, formatContent, formatFiles, formatFragments, formatRead, formatStatus } from '../lib/format.js'

test('filetimeToIso converts a FILETIME and ignores empty values', () => {
  assert.equal(filetimeToIso(0), undefined)
  assert.equal(filetimeToIso(-1), undefined)
  const iso = filetimeToIso(134368593493822223)
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test('formatFiles renders items, sizes, dates, and the capped header', () => {
  const value = {
    items: [{ path: 'D:\\docs\\a.pdf', size: 12, modified: '2026-01-01T00:00:00.000Z' }],
    truncated: true,
  }
  const text = formatFiles(value)
  assert.match(text, /Found 1 path\(s\) \(capped\)/)
  assert.match(text, /D:\\docs\\a\.pdf\t12 B\t2026-01-01T00:00:00\.000Z/)
  assert.match(text, /raise limit/)
})

test('formatFiles handles an empty result', () => {
  assert.equal(formatFiles({ items: [], truncated: false }), 'No files found.')
  // Everything 在索引过滤之前就截断了，所以命中存在时窗口也可能是空的：
  // 这种时候要说明，而不是断言没有文件。
  const text = formatFiles({ items: [], truncated: true })
  assert.match(text, /No files found in the returned window/)
  assert.match(text, /raise limit/)
})

test('formatContent renders refs and total', () => {
  const text = formatContent({
    items: [{ ref: 'fid-1', path: 'D:\\docs\\a.pdf' }],
    total: 7,
    truncated: true,
  })
  assert.match(text, /1 of 7 matching file\(s\)/)
  assert.match(text, /fid-1\tD:\\docs\\a\.pdf/)
  assert.doesNotMatch(text, /max 100/)
  assert.doesNotMatch(text, /narrow/)
})

test('formatContent says the cap once it is reached', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ref: `fid-${index}`, path: `D:\\docs\\${index}.pdf` }))
  const text = formatContent({ items, total: 205, truncated: true })
  assert.match(text, /100 of 205 matching file\(s\)/)
  assert.match(text, /max 100 shown/)
  assert.doesNotMatch(text, /for more/)
})

test('formatContent says when allRoots fell back to the workspace', () => {
  assert.match(
    formatContent({ items: [], total: 0, scopeFallback: true }),
    /scope=all found no available root; searched the workspace instead\./,
  )
})

test('formatContent lists configured roots that were skipped', () => {
  assert.match(
    formatContent({ items: [], total: 0, scopeMissing: ['D:\\Projects'] }),
    /skipped configured root\(s\) that do not exist: D:\\Projects/,
  )
})

test('formatContent does not call the hit count an index total', () => {
  // 0 是这次查询的命中数，不是索引里的文档总数；文案不能让人读成索引是空的。
  assert.equal(formatContent({ items: [], total: 0 }), 'No content matches for this query.')
})

test('formatFragments joins snippets and handles empty', () => {
  assert.equal(formatFragments({ fragments: ['a', 'b'] }), 'a\n---\nb')
  assert.equal(formatFragments({ fragments: [] }), 'No fragments returned.')
})

test('formatRead reports the total and the shown window', () => {
  const text = formatRead({ text: 'hello', totalChars: 10, offset: 2, returned: 5 })
  // 终点是闭区间，所以从 2 起的 5 个字符读作 2..6，两个数可以直接相减。
  assert.match(text, /chars 10; showing 2\.\.6/)
  assert.match(text, /hello/)
})

test('formatRead says so when the window is past the end', () => {
  const text = formatRead({ text: '', totalChars: 10, offset: 10, returned: 0 })
  assert.match(text, /nothing to show at offset 10/)
})

test('formatStatus marks skipped probes and lists registered engines', () => {
  const text = formatStatus({
    everything: { ok: false, code: 'SKIPPED', message: 'not checked because engine=anytxt' },
    anytxt: { ok: true, url: 'http://127.0.0.1:9920' },
    engines: { files: ['everything'], content: ['anytxt'] },
    roots: { workspace: 'D:\\Projects' },
  })
  assert.match(text, /Everything: SKIPPED/)
  assert.match(text, /Anytxt: OK/)
  assert.match(text, /engines=files:everything content:anytxt/)
})

test('formatStatus shows both engines and roots', () => {
  const text = formatStatus({
    everything: { ok: true, version: '1.4.1.1030', path: 'C:\\Everything\\es.exe' },
    anytxt: { ok: false, code: 'ANYTXT_DOWN', message: 'not running' },
    roots: { workspace: 'D:\\Projects', work: 'D:\\Projects', personal: 'D:\\Documents', all: ['C:\\', 'D:\\'], default: 'all' },
  })
  assert.match(text, /Everything: OK \(1\.4\.1\.1030\)/)
  assert.match(text, /Anytxt: DOWN — ANYTXT_DOWN: not running/)
  assert.match(text, /all=C:\\,D:\\/)
  assert.match(text, /default=all/)
})

test('formatStatus marks a scope=all fallback to the workspace', () => {
  const text = formatStatus({
    everything: { ok: true },
    anytxt: { ok: true },
    roots: { all: ['D:\\Projects'], allFallback: true, default: 'all' },
  })
  assert.match(text, /^allFallback=workspace$/m)
  // 全部缺失时由 allFallback 说清，不再重复列 missing。
  assert.doesNotMatch(text, /allMissing=/)
})

test('formatStatus lists configured roots that are missing', () => {
  const text = formatStatus({
    everything: { ok: true },
    anytxt: { ok: true },
    roots: { all: ['C:\\'], allMissing: ['D:\\Projects'], default: 'all' },
  })
  assert.match(text, /^allMissing=D:\\Projects$/m)
  assert.doesNotMatch(text, /allFallback=/)
})

test('a cancelled probe reads as ABORTED, not as a dead engine', () => {
  const text = formatStatus({
    everything: { ok: false, code: 'EVERYTHING_ABORTED', message: 'aborted' },
    anytxt: { ok: false, code: 'ANYTXT_ABORTED', message: 'aborted' },
    roots: {},
  })
  assert.match(text, /Everything: ABORTED — EVERYTHING_ABORTED/)
  assert.match(text, /Anytxt: ABORTED — ANYTXT_ABORTED/)
  assert.doesNotMatch(text, /DOWN/)
})

test('the model-facing output never leaks the page-only fields', () => {
  // 给模型的输出只给「能不能用」：四态、修法、提示、插件版本、平台都不许进这一份输出，否则模型会把
  // 一次检索失败升级成一次环境排查（见 docs/architecture.md 的 two outputs 一节）。
  const text = formatStatus({
    everything: {
      ok: false,
      code: 'EVERYTHING_DOWN',
      message: 'the engine did not answer',
      state: 'down',
      detail: 'not-running',
      hint: 'start the Everything executable',
    },
    anytxt: {
      ok: true,
      url: 'http://127.0.0.1:9920',
      state: 'ready',
      detail: 'not-running-by-name-only',
      hint: 'a page-only hint',
    },
    roots: { workspace: 'D:\\Alpha' },
    platform: 'win32',
    plugin: '0.4.0',
  })
  assert.doesNotMatch(text, /not-running|page-only hint|start the Everything executable/)
  assert.doesNotMatch(text, /state=|platform=|plugin=/)
  assert.match(text, /^Everything: DOWN — EVERYTHING_DOWN: the engine did not answer$/m)
  assert.match(text, /^Anytxt: OK at http:\/\/127\.0\.0\.1:9920$/m)
})
