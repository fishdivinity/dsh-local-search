/**
 * `apply` 的路由装配测试。
 *
 * 为什么单独立一个文件：路由处理器本身有测试（`route.test.js`），但它们全部注入假 builder——
 * `apply` 里把哪个函数注册给哪条路由，之前没有任何测试。0.4.4 正是把 `buildDiagnose`（吃选项
 * 对象）直接注册给期望 `(query) => payload` 的路由，302 个测试全绿、typecheck 也没拦住，
 * 「复制诊断」100% 500。
 * 探测通过 `apply` 的注入点换掉：装配测试不该 spawn es.exe 或连 Anytxt，也不该依赖这台机器。
 * 断言里带上假探测的版本号，顺带证明结果真的流过了注册的那条路。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { DIAGNOSE_ROUTE, STATUS_ROUTE } from '../lib/route.js'

/** 假探测：固定的两个后端，版本号一眼能认出来。 */
const FAKE_PROBE = async () => ({
  engines: {
    everything: { ok: true, version: '9.9.9', path: 'C:\\fake\\es.exe', state: 'ready' },
    anytxt: { ok: true, url: 'http://127.0.0.1:9', state: 'ready' },
  },
})

/** 最小的 Host postbox：只实现 `apply` 实际用到的面。 */
function fakeCtx() {
  const states = { routes: new Map(), injections: [], disposers: [] }
  const ctx = {
    logger: { info() {}, warn() {} },
    root: { loader: { await: async () => {} } },
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    effect: (fn) => {
      const dispose = fn()
      states.disposers.push(dispose)
      return () => {}
    },
    inject: (deps, callback) => states.injections.push({ deps, callback }),
    get: (name) => (name === 'profileContext' ? { name: 'desktop' } : undefined),
  }
  return { ctx, states }
}

/** 假响应：记下状态码与 body，够断言一次 JSON 回答。 */
function fakeResponse() {
  const calls = []
  return {
    calls,
    writeHead(status, headers) { calls.push({ status, headers }) },
    end(body) { calls.push({ body }) },
  }
}

/**
 * 跑一次真实的 `apply`，把四条路由取回来。
 * @param {object} overrides - 传给 `apply` 的第三个参数（这里是 `probe`）
 * @returns {Promise<{routes: Map<string, object>, dispose: () => void}>} 路由表与清理函数
 */
async function mountRoutes(overrides) {
  const { ctx, states } = fakeCtx()
  await apply(ctx, { checkEnginesOnStart: false }, overrides)
  const server = {
    register(route) {
      states.routes.set(route.path, route)
      return () => states.routes.delete(route.path)
    },
  }
  const webCtx = {
    get: (name) => (name === 'webServer' ? server : undefined),
    effect: (fn) => {
      const dispose = fn()
      states.disposers.push(dispose)
      return () => {}
    },
  }
  const web = states.injections.find((entry) => entry.deps.includes('webServer'))
  assert.ok(web !== undefined, 'apply must register the page routes when a web server exists')
  web.callback(webCtx)
  return {
    routes: states.routes,
    dispose: () => {
      for (const dispose of states.disposers) dispose?.()
    },
  }
}

test('apply registers a diagnose handler that accepts the page query', async () => {
  const mounted = await mountRoutes({ probe: FAKE_PROBE })
  try {
    assert.ok(mounted.routes.has(DIAGNOSE_ROUTE), 'the diagnose route must be registered')
    const response = fakeResponse()
    await mounted.routes.get(DIAGNOSE_ROUTE).handler(
      { method: 'GET', url: `${DIAGNOSE_ROUTE}?dsh=0.2.2&shell=desktop`, headers: {} },
      response,
    )
    // 传错 builder 时这里是 500 + 「Cannot read properties of undefined」。
    const head = response.calls.find((call) => call.status !== undefined)
    assert.equal(head?.status, 200)
    const body = JSON.parse(response.calls.at(-1).body)
    assert.match(body.text, /^# dsh-local-search diagnostics/)
    // 「dsh 版本」来自页面查询串：它证明 handler 真的把 URLSearchParams 交给了 builder。
    assert.match(body.text, /^dsh 0\.2\.2 \(reported by the page\)$/m)
    // 版本号来自假探测：证明探测结果流过的是注册的那条路，而不是另一次真实探测。
    assert.match(body.text, /^Everything: OK \(9\.9\.9\)/m)
  } finally {
    mounted.dispose()
  }
})

test('apply registers a status handler that answers with the injected probe', async () => {
  const mounted = await mountRoutes({ probe: FAKE_PROBE })
  try {
    assert.ok(mounted.routes.has(STATUS_ROUTE), 'the status route must be registered')
    const response = fakeResponse()
    await mounted.routes.get(STATUS_ROUTE).handler(
      { method: 'GET', url: STATUS_ROUTE, headers: {} },
      response,
    )
    const body = JSON.parse(response.calls.at(-1).body)
    assert.equal(body.ok, true)
    assert.equal(body.engines.everything.version, '9.9.9')
    assert.equal(body.engines.anytxt.url, 'http://127.0.0.1:9')
  } finally {
    mounted.dispose()
  }
})
