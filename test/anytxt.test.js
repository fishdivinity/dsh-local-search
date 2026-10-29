import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anytxtStatus,
  quoteAware,
  resolveAnytxtUrls,
  searchContent,
  stripHighlights,
} from '../lib/anytxt.js'

test('quoteAware uses exact mode for quoted phrases', () => {
  assert.deepEqual(quoteAware('"方案 设计"'), { pattern: '方案 设计', st: '1' })
  assert.deepEqual(quoteAware('方案 & 设计'), { pattern: '方案 & 设计', st: '2' })
})

test('stripHighlights removes Anytxt markers', () => {
  assert.equal(stripHighlights('a *<<*b*>>* c'), 'a b c')
})

test('a non-local endpoint is refused where it is used, not at activation', () => {
  for (const url of ['http://127.0.0.1:9920', 'http://localhost:9920', 'https://[::1]:9921']) {
    assert.ok(resolveAnytxtUrls(url).length >= 1, url)
  }
  for (const url of ['http://example.com:9920', 'http://192.168.1.20:9920']) {
    assert.throws(() => resolveAnytxtUrls(url), (error) => error.code === 'ANYTXT_ENDPOINT_REMOTE', url)
  }
})

test('resolveAnytxtUrls adds the 9921 fallback only for the default port', () => {
  assert.deepEqual(resolveAnytxtUrls('http://127.0.0.1:9920'), [
    'http://127.0.0.1:9920',
    'http://127.0.0.1:9921',
  ])
  assert.deepEqual(resolveAnytxtUrls('http://127.0.0.1:9922'), ['http://127.0.0.1:9922'])
})

test('searchContent counts, pages, and maps file tuples', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, method: body.method, input: body.params.input })
    const output = body.method.endsWith('.Search')
      ? { count: 2 }
      : {
          count: 2,
          files: [
            ['fid-1', 1700000000, 123, 'D:\\docs\\a.pdf'],
            ['fid-2', 1700000100, 456, 'D:\\docs\\b.docx'],
          ],
        }
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: { output } } }),
    }
  }
  const result = await searchContent({
    query: '"方案"',
    roots: ['D:\\docs'],
    limit: 2,
    url: 'http://127.0.0.1:9920',
    fetchImpl,
  })
  assert.equal(result.total, 2)
  assert.equal(result.items.length, 2)
  assert.equal(result.truncated, false)
  assert.equal(result.items[0].ref, 'fid-1')
  assert.equal(calls[0].input.st, '1')
  assert.equal(calls[1].input.limit, '2')
})

test('anytxtStatus reports DOWN when fetch fails', async () => {
  const status = await anytxtStatus({
    url: 'http://127.0.0.1:9920',
    fetchImpl: async () => {
      throw new Error('refused')
    },
  })
  assert.equal(status.ok, false)
  assert.equal(status.code, 'ANYTXT_DOWN')
})
