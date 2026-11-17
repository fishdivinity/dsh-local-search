/**
 * 后端返回形状的契约测试。
 *
 * 钉住的是「换一个后端不换形状」：每个注册后端都走同一对构造函数（`lib/result.js`），键集合、
 * 类型、`truncated` 语义与渲染首行因此只有一份实现。adapter 的 raw 用同一份 fixture 表示——
 * 真实 adapter 的归一（日期、元组解析）由各自的单测负责，这里只管契约。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { engineEntries } from '../lib/engines.js'
import { assertShape, contentResult, filesResult } from '../lib/result.js'
import { formatContent, formatFiles } from '../lib/format.js'

/** 一份合法的文件名 raw：一条完整、一条只有路径（其余字段可选）。 */
const FILES_RAW = {
  items: [
    { path: 'D:\\alpha\\a.txt', size: 3, modified: '2026-01-02T03:04:05.000Z' },
    { path: 'D:\\alpha\\b.txt' },
  ],
  truncated: true,
}

/** 一份合法的内容 raw：`ref` 是后端自己的 id，不带引擎前缀。 */
const CONTENT_RAW = {
  items: [{ ref: '7', path: 'D:\\docs\\a.pdf', size: 10, modified: '2026-01-02T03:04:05.000Z' }],
  total: 5,
  truncated: true,
}

test('every registered backend goes through the same result builders', () => {
  const entries = engineEntries()
  assert.ok(entries.length >= 2, 'the registry must list both kinds')
  for (const { id, kind } of entries) {
    const built = kind === 'files' ? filesResult(FILES_RAW) : contentResult(CONTENT_RAW, { engine: id })
    assertShape(built, kind)

    if (kind === 'files') {
      // 文件名结果不带 engine：模型看到的形状这版不许变。
      assert.deepEqual(Object.keys(built).sort(), ['items', 'truncated'])
      assert.equal('engine' in built.items[0], false)
      assert.match(formatFiles(built), /^Found 2 path\(s\) \(capped\)/m)
    } else {
      assert.equal(built.items[0].engine, id)
      assert.match(built.items[0].ref, new RegExp(`^${id}:`))
      assert.equal(built.total, 5)
      assert.match(formatContent(built), /^1 of 5 matching file\(s\)$/m)
    }
  }
})

test('a raw item that breaks the contract is refused, not silently trimmed', () => {
  // 少字段、日期不是 ISO、多出未声明的键：三种都要在模型看到之前炸掉，否则它只会以为「少了一列」。
  assert.throws(() => filesResult({ items: [{ size: 3 }], truncated: false }), /has no path/)
  assert.throws(() => filesResult({ items: [{ path: 'a', modified: 'yesterday' }], truncated: false }), /ISO/)
  // 构造函数只拷贝声明过的键；形状层面的多余键由 `assertShape` 挡住。
  assert.throws(() => assertShape({ items: [], truncated: false, total: 3 }, 'files'), /extra keys/)
  assert.throws(() => contentResult({ items: [{ path: 'a.pdf' }], total: 1, truncated: false }, { engine: 'anytxt' }), /has no ref/)
  assert.throws(() => contentResult({ items: [], total: 1 }, {}), /needs an engine name/)
  assert.throws(() => assertShape({ items: [], truncated: 'yes' }, 'files'), /not a boolean/)
})

test('the raw top level is checked, not absorbed', () => {
  // 这三类是「换后端少字段」的真实形状：早先的实现会把它们静默变成空结果 / 假 truncated。
  assert.throws(() => filesResult({}), /items is not an array/)
  assert.throws(() => filesResult({ items: [] }), /truncated is not a boolean/)
  assert.throws(() => filesResult(null), /raw is not an object/)
  assert.throws(() => contentResult({ items: [], truncated: false }, { engine: 'anytxt' }), /total is not a count/)
  assert.throws(() => contentResult({ items: [], total: -1, truncated: false }, { engine: 'anytxt' }), /total/)
  assert.throws(() => contentResult({ items: [], total: 0, truncated: 'yes' }, { engine: 'anytxt' }), /truncated/)
  // 合法的 raw 原样通过，不因为严格而拒收。
  assert.deepEqual(filesResult({ items: [], truncated: false }), { items: [], truncated: false })
})
