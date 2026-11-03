import test from 'node:test'
import assert from 'node:assert/strict'
import { toStatus } from '../lib/probe.js'

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
