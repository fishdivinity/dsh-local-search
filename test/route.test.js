import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_ROUTE, registerStatusRoute, statusHandler } from '../lib/route.js'

/** A minimal HTTP response that records what the handler wrote. */
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

  // No browser headers at all: a local process, which the CSRF risk does not cover.
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
