import test from 'node:test'
import assert from 'node:assert/strict'
import { engineNames, resolveContentEngine, resolveFilesEngine } from '../lib/engines.js'

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
