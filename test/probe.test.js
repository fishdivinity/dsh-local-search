import test from 'node:test'
import assert from 'node:assert/strict'
import { healthFailures, probeSettled, toStatus } from '../lib/probe.js'

// 这里只打 `toStatus`：`probeEngines` 会真的 spawn es.exe 并连 Anytxt，不是单测该跑的东西。

test('the model-facing view keeps ok plus what the engine reported', () => {
  assert.deepEqual(toStatus({ state: 'ready', version: '1.4.1.1030', path: 'C:\\Everything\\es.exe' }), {
    ok: true,
    version: '1.4.1.1030',
    path: 'C:\\Everything\\es.exe',
  })
  assert.deepEqual(toStatus({ state: 'ready', url: 'http://127.0.0.1:9920' }), {
    ok: true,
    url: 'http://127.0.0.1:9920',
  })
})

test('a failed probe reaches the model as ok/code/message only', () => {
  assert.deepEqual(
    toStatus({
      state: 'missing-tool',
      detail: 'es-missing',
      code: 'EVERYTHING_ES_NOT_FOUND',
      message: 'es.exe was not found',
    }),
    { ok: false, code: 'EVERYTHING_ES_NOT_FOUND', message: 'es.exe was not found' },
  )
})

test('the model-facing view never leaks state or detail', () => {
  // 模型手里有 pwsh / grep / glob：给它「缺工具」的细分类，它会把一次检索失败升级成一次环境排查。
  const results = [
    { state: 'ready', version: '1.4.1.1030', path: 'C:\\Everything\\es.exe' },
    { state: 'missing-tool', detail: 'not-installed', code: 'EVERYTHING_ES_NOT_FOUND', message: 'es.exe was not found' },
    { state: 'down', detail: 'not-running', code: 'EVERYTHING_DOWN', message: 'es.exe exited 1' },
  ]
  for (const result of results) {
    const status = toStatus(result)
    assert.equal('state' in status, false, result.state)
    assert.equal('detail' in status, false, result.state)
  }
})

test('the page-facing view adds state on both outcomes and the reason when it failed', () => {
  assert.deepEqual(toStatus({ state: 'ready', version: '1.4.1.1030', path: 'C:\\Everything\\es.exe' }, true), {
    ok: true,
    version: '1.4.1.1030',
    path: 'C:\\Everything\\es.exe',
    state: 'ready',
  })
  assert.deepEqual(
    toStatus({ state: 'down', detail: 'not-running', code: 'EVERYTHING_DOWN', message: 'es.exe exited 1' }, true),
    { ok: false, code: 'EVERYTHING_DOWN', message: 'es.exe exited 1', state: 'down', detail: 'not-running' },
  )
})

test('a failed probe hands the address it tried to the diagnostics, not to the model', () => {
  const failure = {
    state: 'down',
    detail: 'unknown',
    code: 'ANYTXT_DOWN',
    message: 'Anytxt JSON-RPC is unreachable (ECONNREFUSED)',
    url: 'http://127.0.0.1:9920',
    tried: ['http://127.0.0.1:9920', 'http://127.0.0.1:9921'],
  }
  const page = toStatus(failure, true)
  assert.equal(page.url, 'http://127.0.0.1:9920')
  assert.deepEqual(page.tried, failure.tried)
  // 模型那份连地址都不带：它只需要「能不能用」。
  const model = toStatus(failure)
  assert.equal('url' in model, false)
  assert.equal('tried' in model, false)
})

const READY_BOTH = { everything: { ok: true, state: 'ready' }, anytxt: { ok: true, state: 'ready' } }
const ANYTXT_TIMEOUT = {
  everything: { ok: true, state: 'ready' },
  anytxt: { ok: false, state: 'down', detail: 'unknown', code: 'ANYTXT_TIMEOUT', message: 'Anytxt request timed out' },
}

test('healthFailures keeps failures and drops skipped or aborted probes', () => {
  assert.deepEqual(healthFailures({
    everything: { ok: false, state: 'down', detail: 'not-running', code: 'EVERYTHING_DOWN' },
    anytxt: { ok: false, code: 'SKIPPED' },
  }), [{ engine: 'everything', state: 'down', detail: 'not-running', code: 'EVERYTHING_DOWN' }])
  assert.deepEqual(healthFailures({ anytxt: { ok: false, code: 'ANYTXT_ABORTED' } }), [])
})

test('a transient failure is probed once more before it is reported', async () => {
  let calls = 0
  const waits = []
  const result = await probeSettled({}, {
    probe: async () => {
      calls += 1
      return calls === 1 ? ANYTXT_TIMEOUT : READY_BOTH
    },
    wait: async (ms) => { waits.push(ms) },
  })
  assert.equal(calls, 2, 'one retry, not a loop')
  assert.deepEqual(waits, [3000], 'the retry waits before asking again')
  assert.equal(result, READY_BOTH, 'the answer is the second probe')
})

test('a healthy first probe costs no retry', async () => {
  let calls = 0
  const result = await probeSettled({}, {
    probe: async () => { calls += 1; return READY_BOTH },
    wait: async () => { throw new Error('a healthy probe must not wait') },
  })
  assert.equal(calls, 1)
  assert.equal(result, READY_BOTH)
})

test('a deterministic failure is reported without waiting', async () => {
  // 没装 es.exe 不会在 3 秒内变好：重试只会把报错推迟，还多跑一遍 where.exe。
  const deterministic = {
    everything: { ok: false, state: 'missing-tool', detail: 'not-installed', code: 'EVERYTHING_ES_NOT_FOUND' },
    anytxt: { ok: true, state: 'ready' },
  }
  let calls = 0
  const answer = await probeSettled({}, {
    probe: async () => { calls += 1; return deterministic },
    wait: async () => { throw new Error('a deterministic failure must not wait') },
  })
  assert.equal(calls, 1)
  assert.equal(answer, deterministic)
})

test('an aborted context stops before the second probe', async () => {
  const controller = new AbortController()
  let calls = 0
  const answer = await probeSettled({}, {
    signal: controller.signal,
    probe: async () => { calls += 1; controller.abort(); return ANYTXT_TIMEOUT },
    wait: async () => {},
  })
  assert.equal(calls, 1)
  assert.equal(answer, ANYTXT_TIMEOUT, 'the first answer stands, and nothing is reported as healthy')
})
