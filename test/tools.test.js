import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createTools } from '../lib/tools.js'
import { contentResult, filesResult } from '../lib/result.js'

/**
 * 执行器在 render 之前按 `output.schema` 校验值：schema 少声明一个键，真实调用就整条失败，
 * 而只渲染、不校验的测试发现不了。这里用执行器同一个校验函数，把 schema 与 execute 会交出的
 * 形状钉在一起。
 */
const tools = createTools({}, {})
const schemaOf = (name) => tools.find((tool) => tool.name === name).output.schema
const violations = (name, value) => validateJsonSchemaValue(schemaOf(name), value, 'value')

const FILE_ITEM = { path: 'C:\\docs\\a.txt', size: 12, modified: '2026-01-01T00:00:00.000Z' }
const CONTENT_RAW = { items: [{ path: 'C:\\docs\\a.pdf', ref: '123' }], total: 1, truncated: false }

test('files 输出 schema 接受契约层交出的值', () => {
  assert.deepEqual(violations('local_search_files', filesResult({ items: [FILE_ITEM], truncated: false })), [])
})

test('content 输出 schema 接受契约层交出的值', () => {
  assert.deepEqual(violations('local_search_content', contentResult(CONTENT_RAW, { engine: 'anytxt' })), [])
})

test('content 输出 schema 接受退回 workspace 与跳过缺失根时的两个键', () => {
  const value = {
    ...contentResult(CONTENT_RAW, { engine: 'anytxt' }),
    scopeFallback: true,
    scopeMissing: ['C:\\gone'],
  }
  assert.deepEqual(violations('local_search_content', value), [])
})

test('content 输出 schema 仍然拒收未声明的键', () => {
  const value = { ...contentResult(CONTENT_RAW, { engine: 'anytxt' }), bogus: 1 }
  assert.ok(violations('local_search_content', value).length > 0)
})

test('其余工具的 schema 接受 execute 的字面量', () => {
  const values = {
    local_search_fragments: { fragments: ['a', 'b'] },
    local_search_read: { text: 'abc', totalChars: 3, offset: 0, returned: 3 },
    local_search_status: { text: 'ok' },
  }
  for (const [name, value] of Object.entries(values)) {
    assert.deepEqual(violations(name, value), [], `${name} rejects its own output`)
  }
})
