import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anytxtCandidates,
  anytxtInstalled,
  probe,
  quoteAware,
  resolveAnytxtUrls,
  searchContent,
  stripHighlights,
} from '../lib/anytxt.js'

test('quoteAware uses exact mode for quoted phrases', () => {
  assert.deepEqual(quoteAware('"方案 设计"'), { pattern: '方案 设计', st: '1' })
  assert.deepEqual(quoteAware('方案 & 设计'), { pattern: '方案 & 设计', st: '2' })
})

/** 一个按 filterDir 返回结果的 Anytxt 假服务；每个条目是 `[fid, path]`。 */
function anytxtStub(byRoot) {
  return async (_url, init) => {
    const body = JSON.parse(init.body)
    const input = body.params.input
    const entries = byRoot[input.filterDir] ?? []
    const files = entries.map(([fid, path], index) => [fid, 1700000000 + index, 100 + index, path])
    const output = body.method.endsWith('.Search')
      ? { count: files.length }
      : { count: files.length, files }
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: { output } } }),
    }
  }
}

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

test('searchContent keeps the top item of every root when the limit is small', async () => {
  const result = await searchContent({
    query: '任务中心',
    roots: ['C:\\', 'D:\\'],
    limit: 2,
    fetchImpl: anytxtStub({
      'C:\\': [['c1', 'C:\\c1.md'], ['c2', 'C:\\c2.md']],
      'D:\\': [['d1', 'D:\\d1.md'], ['d2', 'D:\\d2.md']],
    }),
  })
  // 按根拼接会把 C 的两条先占满；轮转后 D 的第一条必须留下。
  assert.deepEqual(result.items.map((item) => item.ref), ['c1', 'd1'])
  assert.equal(result.total, 4)
  assert.equal(result.truncated, true)
})

test('searchContent puts an exact file-name match first', async () => {
  const result = await searchContent({
    query: '任务中心测试问题清单',
    roots: ['C:\\', 'D:\\'],
    limit: 2,
    fetchImpl: anytxtStub({
      'C:\\': [['c1', 'C:\\notes.md'], ['c2', 'C:\\other.md']],
      'D:\\': [['d1', 'D:\\docs\\任务中心测试问题清单.xlsx'], ['d2', 'D:\\d2.md']],
    }),
  })
  assert.deepEqual(result.items.map((item) => item.ref), ['d1', 'c1'])
})

test('searchContent does not treat a query with operators as a file name', async () => {
  const result = await searchContent({
    query: 'a & b',
    roots: ['C:\\', 'D:\\'],
    limit: 2,
    fetchImpl: anytxtStub({
      'C:\\': [['c1', 'C:\\c1.md']],
      'D:\\': [['d1', 'D:\\a & b.md']],
    }),
  })
  assert.deepEqual(result.items.map((item) => item.ref), ['c1', 'd1'])
})

test('an unreachable Anytxt reads as not-running only when the install is there', async () => {
  const refused = async () => {
    throw new Error('refused')
  }
  const found = await probe({ url: 'http://127.0.0.1:9921', fetchImpl: refused, installed: () => true })
  assert.equal(found.state, 'down')
  assert.equal(found.detail, 'not-running')
  assert.equal(found.code, 'ANYTXT_DOWN')
  // 诊断要能说清「试的是哪个地址」。
  assert.equal(found.url, 'http://127.0.0.1:9921')
  assert.deepEqual(found.tried, ['http://127.0.0.1:9921'])
  // `EngineError.hint` 不进工具返回，所以也不能从探针里漏出来。
  assert.equal('hint' in found, false)

  // 找不到 ATGUI.exe 不等于没装（便携版、自定义目录）：这时不下「没在运行」的结论。
  const unknown = await probe({ url: 'http://127.0.0.1:9920', fetchImpl: refused, installed: () => null })
  assert.equal(unknown.state, 'down')
  assert.equal(unknown.detail, 'unknown')
  assert.equal(unknown.code, 'ANYTXT_DOWN')
  // 9920 连不上会去试 9921：两个都记下来，贴 issue 时才能排除「端口写错」。
  assert.deepEqual(unknown.tried, ['http://127.0.0.1:9920', 'http://127.0.0.1:9921'])
})

test('an unreachable message carries the transport cause when there is one', async () => {
  const result = await probe({
    url: 'http://127.0.0.1:9920',
    fetchImpl: async () => {
      const error = new Error('fetch failed')
      error.cause = { code: 'ECONNREFUSED' }
      throw error
    },
    installed: () => null,
  })
  assert.equal(result.code, 'ANYTXT_DOWN')
  assert.match(result.message, /unreachable/)
  assert.match(result.message, /ECONNREFUSED/)
})

test('probe answers ready with the port that answered, not the one tried first', async () => {
  // 自动配置要把「哪个端口能用」写回配置；报第一个尝试的端口等于把结论写反。
  const tried = []
  const result = await probe({
    url: 'http://127.0.0.1:9920',
    fetchImpl: async (url) => {
      tried.push(url)
      if (url === 'http://127.0.0.1:9920') {
        const refused = new Error('refused')
        refused.name = 'TypeError'
        throw refused
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: { output: { count: 1 } } } }),
      }
    },
  })
  assert.equal(tried.length, 2, 'both ports are tried')
  assert.deepEqual(result, { state: 'ready', url: 'http://127.0.0.1:9921' })
})

test('every other Anytxt failure is down without a fix we can name', async () => {
  const cases = [
    { label: 'HTTP', fetchImpl: async () => ({ ok: false, status: 500 }), code: 'ANYTXT_HTTP' },
    {
      label: 'RPC',
      fetchImpl: async () => ({ ok: true, json: async () => ({ error: { message: 'bad query' } }) }),
      code: 'ANYTXT_RPC',
    },
    {
      label: 'timeout',
      fetchImpl: async () => {
        const error = new Error('timed out')
        error.name = 'TimeoutError'
        throw error
      },
      code: 'ANYTXT_TIMEOUT',
    },
    {
      label: 'non-JSON',
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('not json')
        },
      }),
      code: 'ANYTXT_BAD_OUTPUT',
    },
  ]
  for (const { label, fetchImpl, code } of cases) {
    // 9921 没有回退口，所以一个 case 只发一次请求。
    const result = await probe({ url: 'http://127.0.0.1:9921', fetchImpl })
    assert.deepEqual(
      { state: result.state, detail: result.detail, code: result.code },
      { state: 'down', detail: 'unknown', code },
      label,
    )
  }
})

test('a non-local endpoint is down rather than thrown at the page', async () => {
  let calls = 0
  const result = await probe({
    url: 'http://192.168.1.20:9920',
    fetchImpl: async () => {
      calls += 1
      throw new Error('should not be reached')
    },
  })
  assert.deepEqual(
    { state: result.state, detail: result.detail, code: result.code },
    { state: 'down', detail: 'unknown', code: 'ANYTXT_ENDPOINT_REMOTE' },
  )
  assert.equal(calls, 0)
})

test('a cancelled probe keeps its own code', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await probe({
    url: 'http://127.0.0.1:9921',
    signal: controller.signal,
    fetchImpl: async () => {
      throw new Error('aborted')
    },
  })
  assert.equal(result.state, 'down')
  assert.equal(result.code, 'ANYTXT_ABORTED')
})

test('the install check only ever says "found" or "cannot tell"', () => {
  const candidates = anytxtCandidates()
  assert.ok(candidates.length > 0)
  for (const candidate of candidates) assert.match(candidate, /ATGUI\.exe$/)
  // 找不到不能断言没装（便携版 / 自定义目录），所以只有 true 与 null 两种答案。
  assert.ok(anytxtInstalled() === true || anytxtInstalled() === null)
})
