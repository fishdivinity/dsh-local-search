import test from 'node:test'
import assert from 'node:assert/strict'
import { engineNames, resolveContentEngine, resolveFilesEngine } from '../lib/engines.js'
import { engineLabel } from '../lib/labels.js'
import { formatStatus } from '../lib/format.js'

test('auto resolves the first registered engine of each kind', () => {
  assert.equal(resolveFilesEngine('auto').name, 'everything')
  assert.equal(resolveContentEngine().name, 'anytxt')
})

test('explicit engine names resolve', () => {
  assert.equal(resolveFilesEngine('everything').name, 'everything')
  assert.equal(resolveContentEngine('anytxt').name, 'anytxt')
})

test('wrong-kind or unknown engines are rejected with ENGINE_UNSUPPORTED', () => {
  assert.throws(
    () => resolveFilesEngine('anytxt'),
    (error) => error.code === 'ENGINE_UNSUPPORTED',
  )
  assert.throws(
    () => resolveContentEngine('everything'),
    (error) => error.code === 'ENGINE_UNSUPPORTED',
  )
})

test('engineNames lists registered providers for status and config pages', () => {
  assert.deepEqual(engineNames(), { files: ['everything'], content: ['anytxt'] })
})

test('the status text takes its labels from one place', () => {
  // 显示名只在 `lib/labels.js` 定义：状态工具与诊断文本都引用它，加后端只改那一处。
  for (const name of [...engineNames().files, ...engineNames().content]) {
    assert.equal(typeof engineLabel(name), 'string')
    assert.notEqual(engineLabel(name), '')
  }
  assert.equal(engineLabel('everything'), 'Everything')
  assert.equal(engineLabel('anytxt'), 'Anytxt')
  assert.equal(engineLabel('unregistered'), 'unregistered')
  const text = formatStatus({
    everything: { ok: true, version: '1.4.1.1030' },
    anytxt: { ok: false, code: 'ANYTXT_DOWN', message: 'down' },
  })
  assert.match(text, /^Everything: OK \(1\.4\.1\.1030\)$/m)
  assert.match(text, /^Anytxt: DOWN — ANYTXT_DOWN: down$/m)
})

test('every registered engine offers probe and no stale status alias', () => {
  const files = resolveFilesEngine('everything')
  assert.deepEqual(Object.keys(files).sort(), ['name', 'probe', 'search'])
  const content = resolveContentEngine('anytxt')
  assert.deepEqual(Object.keys(content).sort(), ['fragments', 'name', 'probe', 'read', 'search'])
  assert.equal(typeof files.probe, 'function')
  assert.equal(typeof content.probe, 'function')
})

test('content results carry an engine-scoped ref', async () => {
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const output = body.method.endsWith('.Search')
      ? { count: 1 }
      : { files: [['fid-1', 1700000000, 123, 'D:\\docs\\a.pdf']] }
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: { output } } }),
    }
  }
  const engine = resolveContentEngine('anytxt')
  const result = await engine.search({
    query: 'a',
    roots: ['D:\\docs'],
    limit: 1,
    url: 'http://127.0.0.1:9920',
    fetchImpl,
  })
  assert.equal(result.items[0].engine, 'anytxt')
  assert.equal(result.items[0].ref, 'anytxt:fid-1')
})
