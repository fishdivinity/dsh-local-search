import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import {
  CHECK_ONLY_PARAM, DESCRIBE_ROUTE, DIAGNOSE_ROUTE, DRAFT_DIR_PARAM, DRAFT_PARAM, DRAFT_PATH_PARAM, LOCALES_ROUTE,
  STATUS_ROUTE, describeHandler, diagnoseHandler, draftDirs, draftEndpoint, draftEsPath, localesHandler,
  registerDescribeRoute, registerDiagnoseRoute, registerLocalesRoute, registerStatusRoute, statusHandler,
} from '../lib/route.js'
import { describeConfig } from '../lib/describe.js'

/** 一个最小的 HTTP 响应，只记录 handler 往里写了什么。 */
function fakeResponse() {
  const calls = []
  return {
    calls,
    writeHead(status, headers) {
      calls.push({ kind: 'head', status, headers })
    },
    end(body) {
      calls.push({ kind: 'end', body })
    },
  }
}

function lastBody(response) {
  return JSON.parse(response.calls.at(-1).body)
}

test('GET answers both engine statuses as JSON', async () => {
  const response = fakeResponse()
  await statusHandler({ method: 'GET' }, response, async () => ({
    everything: { ok: true, version: '1.4.1' },
    anytxt: { ok: false, code: 'ANYTXT_DOWN', message: 'unreachable' },
  }))

  assert.equal(response.calls[0].status, 200)
  assert.equal(response.calls[0].headers['cache-control'], 'no-store')
  const body = lastBody(response)
  assert.equal(body.ok, false)
  assert.equal(body.everything.version, '1.4.1')
  assert.equal(body.anytxt.code, 'ANYTXT_DOWN')
  assert.equal(typeof body.checkedAt, 'number')
})

test('ok is true only when both engines answer', async () => {
  const response = fakeResponse()
  await statusHandler({ method: 'GET' }, response, async () => ({
    everything: { ok: true },
    anytxt: { ok: true, url: 'http://127.0.0.1:9920' },
  }))
  assert.equal(lastBody(response).ok, true)
})

test('a method other than GET or HEAD is refused', async () => {
  const response = fakeResponse()
  await statusHandler({ method: 'POST' }, response, async () => {
    throw new Error('the probe must not run')
  })
  assert.equal(response.calls[0].status, 405)
  assert.equal(response.calls[0].headers.allow, 'GET, HEAD')
})

test('a probe that throws answers 500 instead of crashing the route', async () => {
  const response = fakeResponse()
  await statusHandler({ method: 'GET' }, response, async () => {
    throw new Error('boom')
  })
  assert.equal(response.calls[0].status, 500)
  const body = lastBody(response)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'PROBE_FAILED')
  assert.match(body.message, /boom/)
})

test('a cross-site request is refused before it costs an es.exe spawn', async () => {
  const refusal = async () => {
    throw new Error('the probe must not run')
  }
  const crossSite = fakeResponse()
  await statusHandler(
    { method: 'GET', url: '/dsh-local-search/api/status', headers: { 'sec-fetch-site': 'cross-site' } },
    crossSite,
    refusal,
  )
  assert.equal(crossSite.calls[0].status, 403)
  assert.equal(lastBody(crossSite).code, 'CROSS_SITE_REFUSED')

  const foreignOrigin = fakeResponse()
  await statusHandler(
    {
      method: 'GET',
      url: '/dsh-local-search/api/status',
      headers: { origin: 'http://evil.example', host: '127.0.0.1:12560' },
    },
    foreignOrigin,
    refusal,
  )
  assert.equal(foreignOrigin.calls[0].status, 403)

  // 一个浏览器头都没有：这是本机进程，不在 CSRF 风险范围内。
  const localProcess = fakeResponse()
  await statusHandler({ method: 'GET', url: '/dsh-local-search/api/status' }, localProcess, async () => ({
    everything: { ok: true },
    anytxt: { ok: true },
  }))
  assert.equal(localProcess.calls[0].status, 200)
})

test('HEAD answers without probing and sends no body', async () => {
  const response = fakeResponse()
  let probed = false
  await statusHandler({ method: 'HEAD' }, response, async () => {
    probed = true
    return { everything: { ok: true }, anytxt: { ok: true } }
  })
  assert.equal(probed, false)
  assert.equal(response.calls[0].status, 200)
  assert.equal(response.calls.at(-1).kind, 'end')
  assert.equal(response.calls.at(-1).body, undefined)
})

test('a loopback draft rides the query into the probe', async () => {
  const response = fakeResponse()
  let received
  await statusHandler(
    { method: 'GET', url: '/dsh-local-search/api/status?anytxtUrl=' + encodeURIComponent('http://127.0.0.1:9921') },
    response,
    async (options) => {
      received = options
      return { everything: { ok: true }, anytxt: { ok: false, code: 'ANYTXT_DOWN' } }
    },
  )
  assert.equal(received.anytxtUrl, 'http://127.0.0.1:9921')
  assert.equal(response.calls[0].status, 200)
})

test('a draft that is not a loopback http(s) url is refused before probing', async () => {
  for (const draft of ['http://example.com:9920', 'ftp://127.0.0.1', 'not a url']) {
    const response = fakeResponse()
    await statusHandler(
      { method: 'GET', url: `/dsh-local-search/api/status?anytxtUrl=${encodeURIComponent(draft)}` },
      response,
      async () => {
        throw new Error('the probe must not run')
      },
    )
    assert.equal(response.calls[0].status, 400, draft)
    assert.equal(JSON.parse(response.calls.at(-1).body).code, 'ANYTXT_URL_REJECTED')
  }
})

test('a dead response never rejects the route', async () => {
  let destroyed = false
  await statusHandler(
    { method: 'GET', url: '/dsh-local-search/api/status' },
    {
      writeHead() { throw new Error('EPIPE') },
      end() {},
      destroy() { destroyed = true },
    },
    async () => ({ everything: { ok: true }, anytxt: { ok: true } }),
  )
  assert.equal(destroyed, true)
})

test('without a draft the probe receives no override', async () => {
  const response = fakeResponse()
  let received
  await statusHandler({ method: 'GET', url: '/dsh-local-search/api/status' }, response, async (options) => {
    received = options
    return { everything: { ok: true }, anytxt: { ok: true } }
  })
  assert.equal(received.anytxtUrl, undefined)
})

test('the page-only route asks the probe for the actionable detail', async () => {
  // 模型侧的状态只要两个稳定码；具体成因归这条页面路由。
  let received
  await statusHandler({ method: 'GET', url: '/dsh-local-search/api/status' }, fakeResponse(), async (options) => {
    received = options
    return { everything: { ok: false, code: 'EVERYTHING_DOWN', detail: 'not-running' }, anytxt: { ok: true } }
  })
  assert.equal(received.detail, true)
})

test('the route registers as an exact route on the declared path', () => {
  const registered = []
  const server = {
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  const probe = async () => ({ everything: { ok: true }, anytxt: { ok: true } })
  const dispose = registerStatusRoute(server, {}, probe)

  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'exact')
  assert.equal(registered[0].path, STATUS_ROUTE)
  assert.equal(typeof registered[0].handler, 'function')
  assert.equal(typeof dispose, 'function')
})

test('describe answers the backend list the page renders from', async () => {
  const response = fakeResponse()
  await describeHandler({ method: 'GET', url: DESCRIBE_ROUTE }, response, () => describeConfig())
  assert.equal(response.calls[0].status, 200)
  assert.equal(response.calls[0].headers['cache-control'], 'no-store')
  const body = lastBody(response)
  assert.deepEqual(body.sections.map((section) => section.id), ['files', 'content', 'scopes', 'limits', 'startup'])
  assert.equal(body.autoconfig, undefined)
})

test('describe carries the first-run state when the Host has it', async () => {
  const response = fakeResponse()
  const autoconfig = { pending: false, ran: true, failures: [{ engine: 'anytxt', code: 'ANYTXT_DOWN' }] }
  await describeHandler({ method: 'GET', url: DESCRIBE_ROUTE }, response, () => describeConfig({ autoconfig }))
  assert.deepEqual(lastBody(response).autoconfig, autoconfig)
})

test('describe waits for an asynchronous payload so a deferred write lands first', async () => {
  const response = fakeResponse()
  const order = []
  await describeHandler({ method: 'GET', url: DESCRIBE_ROUTE }, response, async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    order.push('payload')
    return describeConfig({ autoconfig: { pending: false, ran: true, deferred: false } })
  })
  order.push('sent')
  assert.deepEqual(order, ['payload', 'sent'])
  assert.equal(lastBody(response).autoconfig.deferred, false)
  assert.equal(response.calls[0].status, 200)
})

test('describe refuses another site and any method but GET/HEAD', async () => {
  const crossSite = fakeResponse()
  await describeHandler(
    { method: 'GET', url: DESCRIBE_ROUTE, headers: { 'sec-fetch-site': 'cross-site' } },
    crossSite,
    () => {
      throw new Error('the payload must not be built')
    },
  )
  assert.equal(crossSite.calls[0].status, 403)
  assert.equal(lastBody(crossSite).code, 'CROSS_SITE_REFUSED')

  const foreignOrigin = fakeResponse()
  await describeHandler(
    { method: 'GET', url: DESCRIBE_ROUTE, headers: { origin: 'http://evil.example', host: '127.0.0.1:12560' } },
    foreignOrigin,
    () => ({}),
  )
  assert.equal(foreignOrigin.calls[0].status, 403)

  const post = fakeResponse()
  await describeHandler({ method: 'POST', url: DESCRIBE_ROUTE }, post, () => ({}))
  assert.equal(post.calls[0].status, 405)
  assert.equal(post.calls[0].headers.allow, 'GET, HEAD')
})

test('describe answers HEAD without building a payload', async () => {
  const response = fakeResponse()
  await describeHandler({ method: 'HEAD', url: DESCRIBE_ROUTE }, response, () => {
    throw new Error('HEAD must not build the payload')
  })
  assert.equal(response.calls[0].status, 200)
  assert.equal(response.calls.at(-1).body, undefined)
})

test('a describe answer that cannot be written never rejects the route', async () => {
  let destroyed = false
  await describeHandler(
    { method: 'GET', url: DESCRIBE_ROUTE },
    { writeHead() { throw new Error('EPIPE') }, end() {}, destroy() { destroyed = true } },
    () => ({}),
  )
  assert.equal(destroyed, true)
})

test('the describe route registers as an exact route on the declared path', () => {
  const registered = []
  const server = {
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  const dispose = registerDescribeRoute(server, () => ({ sections: [] }))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'exact')
  assert.equal(registered[0].path, DESCRIBE_ROUTE)
  assert.equal(typeof registered[0].handler, 'function')
  assert.equal(typeof dispose, 'function')
})

test('the draft parameter the page appends is the one the route reads', () => {
  assert.equal(DRAFT_PARAM, 'anytxtUrl')
  assert.deepEqual(draftEndpoint(`/dsh-local-search/api/status?${DRAFT_PARAM}=http://127.0.0.1:9921`), {
    ok: true,
    value: 'http://127.0.0.1:9921',
  })
})

test('a draft es.exe path is accepted only when the file really exists', () => {
  assert.equal(DRAFT_PATH_PARAM, 'esPath')
  const accepted = draftEsPath(`/dsh-local-search/api/status?${DRAFT_PATH_PARAM}=${encodeURIComponent(process.execPath)}`)
  assert.equal(accepted.ok, true)
  assert.equal(accepted.value, process.execPath)
  // 规范化只是同一个文件的另一种写法（磁盘上的大小写），不比出差异来。
  assert.equal(typeof accepted.resolved, 'string')
  assert.equal(accepted.resolved.toLowerCase(), process.execPath.toLowerCase())
  assert.deepEqual(
    draftEsPath(`/dsh-local-search/api/status?${DRAFT_PATH_PARAM}=${encodeURIComponent('C:/definitely/not/here/es.exe')}`),
    { ok: false, reason: 'missing' },
  )
  // 目录不是文件：这一条要能说出区别，否则页面只能说「不存在」。
  assert.deepEqual(
    draftEsPath(`/dsh-local-search/api/status?${DRAFT_PATH_PARAM}=${encodeURIComponent(process.cwd())}`),
    { ok: false, reason: 'not-file' },
  )
  // 相对路径不是「在不在」的问题，是根本不该进入配置。
  assert.deepEqual(draftEsPath(`/dsh-local-search/api/status?${DRAFT_PATH_PARAM}=es.exe`), { ok: false, reason: 'missing' })
  assert.deepEqual(draftEsPath('/dsh-local-search/api/status'), { ok: true, value: undefined, resolved: undefined })
})

test('a draft path that does not exist is refused before any probe runs', async () => {
  const response = fakeResponse()
  await statusHandler(
    {
      method: 'GET',
      url: `/dsh-local-search/api/status?${DRAFT_PATH_PARAM}=${encodeURIComponent('C:/definitely/not/here/es.exe')}`,
    },
    response,
    async () => {
      throw new Error('the probe must not run')
    },
  )
  assert.equal(response.calls[0].status, 400)
  assert.equal(lastBody(response).code, 'ES_PATH_REJECTED')
})

test('a draft path that exists lets the probe run', async () => {
  const response = fakeResponse()
  let probed = false
  await statusHandler(
    {
      method: 'GET',
      url: `/dsh-local-search/api/status?${DRAFT_PATH_PARAM}=${encodeURIComponent(process.execPath)}`,
    },
    response,
    async () => {
      probed = true
      return { everything: { ok: true }, anytxt: { ok: true } }
    },
  )
  assert.equal(probed, true)
  assert.equal(response.calls[0].status, 200)
})

test('a draft directory is accepted only when it is an existing directory', () => {
  assert.equal(DRAFT_DIR_PARAM, 'dir')
  const cwd = process.cwd()
  const accepted = draftDirs(`/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent(cwd)}`)
  assert.equal(accepted.ok, true)
  assert.deepEqual(accepted.value, [cwd])
  // 规范写法指向同一个目录（磁盘上的大小写），可能只是写法不同。
  assert.equal(accepted.resolved.length, 1)
  assert.equal(accepted.resolved[0].toLowerCase(), cwd.toLowerCase())
  // Windows 两种分隔符等价，`D:/Alpha` 与 `D:\Alpha` 是同一个目录；`value` 保留输入，`resolved` 给规范写法。
  const forward = cwd.replace(/\\/g, '/')
  const slashed = draftDirs(`/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent(forward)}`)
  assert.equal(slashed.ok, true)
  assert.deepEqual(slashed.value, [forward])
  assert.equal(slashed.resolved[0].toLowerCase(), cwd.toLowerCase())
  // 文件不算目录；不存在与相对路径都拒，且原因分得开。
  assert.deepEqual(
    draftDirs(`/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent(process.execPath)}`),
    { ok: false, reason: 'not-directory' },
  )
  assert.deepEqual(
    draftDirs(`/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent('C:/definitely/not/here')}`),
    { ok: false, reason: 'missing' },
  )
  assert.deepEqual(draftDirs(`/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=relative/dir`), { ok: false, reason: 'missing' })
  assert.deepEqual(draftDirs('/dsh-local-search/api/status'), { ok: true, value: [], resolved: [] })
})

test('a draft directory that does not exist is refused before any probe runs', async () => {
  const response = fakeResponse()
  await statusHandler(
    {
      method: 'GET',
      url: `/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent('C:/definitely/not/here')}`,
    },
    response,
    async () => {
      throw new Error('the probe must not run')
    },
  )
  assert.equal(response.calls[0].status, 400)
  assert.equal(lastBody(response).code, 'DIR_REJECTED')
})

test('a draft directory that exists lets the probe run', async () => {
  const response = fakeResponse()
  let probed = false
  await statusHandler(
    {
      method: 'GET',
      url: `/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent(process.cwd())}`,
    },
    response,
    async () => {
      probed = true
      return { everything: { ok: true }, anytxt: { ok: true } }
    },
  )
  assert.equal(probed, true)
  assert.equal(response.calls[0].status, 200)
})

test('checkOnly answers the drafts without spending an es.exe spawn', async () => {
  assert.equal(CHECK_ONLY_PARAM, 'checkOnly')
  const response = fakeResponse()
  let probed = false
  await statusHandler(
    {
      method: 'GET',
      url: `/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent(process.cwd())}&${CHECK_ONLY_PARAM}=1`,
    },
    response,
    async () => {
      probed = true
      return { everything: { ok: true }, anytxt: { ok: true } }
    },
  )
  assert.equal(probed, false, 'a check-only request must not probe')
  assert.equal(response.calls[0].status, 200)
  const body = lastBody(response)
  assert.equal(body.ok, true)
  assert.equal(body.drafts.dirs.length, 1)
  assert.equal(body.everything, undefined)
})

test('a ~-rooted draft directory is expanded before it is checked', () => {
  // 家目录是从真机读的，别在测试里写死一个用户名；`~` 能过就说明展开发生在存在性校验之前。
  const accepted = draftDirs(`/dsh-local-search/api/status?${DRAFT_DIR_PARAM}=${encodeURIComponent('~')}`)
  assert.equal(accepted.ok, true)
  assert.deepEqual(accepted.value, [homedir()])
  assert.equal(accepted.resolved.length, 1)
  assert.equal(typeof accepted.resolved[0], 'string')
})

const LANGUAGE_PACKS = {
  ja: { 'section.files': 'ファイル' },
  en: { 'section.files': 'Files' },
}

test('diagnose hands the page query to the payload builder', async () => {
  const response = fakeResponse()
  let received
  await diagnoseHandler(
    { method: 'GET', url: `${DIAGNOSE_ROUTE}?shell=desktop-app&remote=no&dsh=0.2.1-rc.5` },
    response,
    async (query) => {
      received = query
      return { text: `shell=${query.get('shell')} remote=${query.get('remote')} dsh=${query.get('dsh')}` }
    },
  )
  assert.ok(received instanceof URLSearchParams)
  assert.equal(response.calls[0].status, 200)
  assert.equal(response.calls[0].headers['cache-control'], 'no-store')
  assert.deepEqual(lastBody(response), {
    text: 'shell=desktop-app remote=no dsh=0.2.1-rc.5',
  })
})

test('diagnose answers HEAD without building the text', async () => {
  const response = fakeResponse()
  await diagnoseHandler({ method: 'HEAD', url: DIAGNOSE_ROUTE }, response, () => {
    throw new Error('HEAD must not build the payload')
  })
  assert.equal(response.calls[0].status, 200)
  assert.equal(response.calls.at(-1).body, undefined)
})

test('diagnose refuses another site and any method but GET/HEAD', async () => {
  const crossSite = fakeResponse()
  await diagnoseHandler(
    { method: 'GET', url: DIAGNOSE_ROUTE, headers: { 'sec-fetch-site': 'cross-site' } },
    crossSite,
    () => {
      throw new Error('the payload must not be built')
    },
  )
  assert.equal(crossSite.calls[0].status, 403)
  assert.equal(lastBody(crossSite).code, 'CROSS_SITE_REFUSED')

  const post = fakeResponse()
  await diagnoseHandler({ method: 'POST', url: DIAGNOSE_ROUTE }, post, () => ({}))
  assert.equal(post.calls[0].status, 405)
  assert.equal(post.calls[0].headers.allow, 'GET, HEAD')
})

test('a diagnose build that throws answers 500 instead of crashing the route', async () => {
  const response = fakeResponse()
  await diagnoseHandler({ method: 'GET', url: DIAGNOSE_ROUTE }, response, () => {
    throw new Error('probe exploded')
  })
  assert.equal(response.calls[0].status, 500)
  const body = lastBody(response)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'PROBE_FAILED')
  assert.match(body.message, /probe exploded/)
})

test('a diagnose answer that cannot be written never rejects the route', async () => {
  let destroyed = false
  await diagnoseHandler(
    { method: 'GET', url: DIAGNOSE_ROUTE },
    { writeHead() { throw new Error('EPIPE') }, end() {}, destroy() { destroyed = true } },
    async () => ({ text: '' }),
  )
  assert.equal(destroyed, true)
})

test('locales answers every pack with a content ETag', async () => {
  const response = fakeResponse()
  await localesHandler({ method: 'GET', url: LOCALES_ROUTE }, response, () => LANGUAGE_PACKS)
  assert.equal(response.calls[0].status, 200)
  // `no-cache` 而不是 `no-store`：允许存、每次回验，ETag 才有机会命中 304。
  assert.equal(response.calls[0].headers['cache-control'], 'no-cache')
  assert.match(response.calls[0].headers.etag, /^"[0-9a-f]{40}"$/)
  // 语言名排序后组装，与 `read()` 给的插入顺序无关。
  assert.deepEqual(Object.keys(lastBody(response)), ['en', 'ja'])
})

test('a matching if-none-match answers 304 with an ETag and no body', async () => {
  const first = fakeResponse()
  await localesHandler({ method: 'GET', url: LOCALES_ROUTE }, first, () => LANGUAGE_PACKS)
  const etag = first.calls[0].headers.etag

  const second = fakeResponse()
  await localesHandler(
    { method: 'GET', url: LOCALES_ROUTE, headers: { 'if-none-match': etag } },
    second,
    () => LANGUAGE_PACKS,
  )
  assert.equal(second.calls[0].status, 304)
  assert.equal(second.calls[0].headers.etag, etag)
  assert.equal(second.calls[0].headers['cache-control'], 'no-cache')
  assert.equal(second.calls.at(-1).kind, 'end')
  assert.equal(second.calls.at(-1).body, undefined)
})

test('two answers with the same content carry the same ETag', async () => {
  const one = fakeResponse()
  await localesHandler({ method: 'GET', url: LOCALES_ROUTE }, one, () => ({ ja: LANGUAGE_PACKS.ja, en: LANGUAGE_PACKS.en }))
  const two = fakeResponse()
  await localesHandler({ method: 'GET', url: LOCALES_ROUTE }, two, () => ({ en: LANGUAGE_PACKS.en, ja: LANGUAGE_PACKS.ja }))
  assert.equal(one.calls[0].headers.etag, two.calls[0].headers.etag)
})

test('locales refuses another site and any method but GET/HEAD', async () => {
  const crossSite = fakeResponse()
  await localesHandler(
    { method: 'GET', url: LOCALES_ROUTE, headers: { 'sec-fetch-site': 'cross-site' } },
    crossSite,
    () => {
      throw new Error('the packs must not be read')
    },
  )
  assert.equal(crossSite.calls[0].status, 403)
  assert.equal(lastBody(crossSite).code, 'CROSS_SITE_REFUSED')

  const post = fakeResponse()
  await localesHandler({ method: 'POST', url: LOCALES_ROUTE }, post, () => ({}))
  assert.equal(post.calls[0].status, 405)
  assert.equal(post.calls[0].headers.allow, 'GET, HEAD')
})

test('locales answers HEAD without reading the packs', async () => {
  const response = fakeResponse()
  await localesHandler({ method: 'HEAD', url: LOCALES_ROUTE }, response, () => {
    throw new Error('HEAD must not read the packs')
  })
  assert.equal(response.calls[0].status, 200)
  // 缓存指令要与 GET 一致；HEAD 不读盘，所以没有 ETag。
  assert.equal(response.calls[0].headers['cache-control'], 'no-cache')
  assert.equal(response.calls.at(-1).body, undefined)
})

test('a describe payload failure answers 500 with the reason', async () => {
  const response = fakeResponse()
  await describeHandler({ method: 'GET', url: DESCRIBE_ROUTE }, response, async () => {
    throw new Error('settle failed')
  })
  assert.equal(response.calls[0].status, 500)
  assert.equal(lastBody(response).code, 'PROBE_FAILED')
  assert.match(lastBody(response).message, /settle failed/)
})

test('the diagnose and locales routes register as exact routes on the declared paths', () => {
  const registered = []
  const server = {
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  const disposeDiagnose = registerDiagnoseRoute(server, async () => ({ text: '' }))
  const disposeLocales = registerLocalesRoute(server, () => ({}))

  assert.deepEqual(registered.map((route) => [route.kind, route.path]), [
    ['exact', DIAGNOSE_ROUTE],
    ['exact', LOCALES_ROUTE],
  ])
  assert.equal(typeof registered[0].handler, 'function')
  assert.equal(typeof registered[1].handler, 'function')
  assert.equal(typeof disposeDiagnose, 'function')
  assert.equal(typeof disposeLocales, 'function')
})
