import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, PATHS, RETIRED_PATHS, foldRetired, pathValue, setPath } from '../lib/config.js'
import { autoconfigNeeds, autoconfigOps, bootstrap, findDescriptor, migrationOps } from '../lib/bootstrap.js'

const NS = 'fishdivinity-local-search'

/** 0.2 形状的配置：旧键在顶层，嵌套结构取默认值。 */
function flatConfig(overrides = {}) {
  return { ...structuredClone(DEFAULTS), ...overrides }
}

/** 嵌套结构的配置：`patch` 深合并进默认值。 */
function nestedConfig(patch = {}) {
  return merge(structuredClone(DEFAULTS), patch)
}

function merge(base, patch) {
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value !== null && typeof value === 'object' && typeof result[key] === 'object'
      ? merge(result[key], value)
      : value
  }
  return result
}

/**
 * 一套活的配置：schema 输出的字段是引用，写操作真的会改到它们。
 *
 * 这是生产里的关键性质——settings 写好之后 volatile 引用就地更新，所以启动配置的第二步
 * 看到的是第一步刚写进去的值。
 * @param options.values - 初始配置（嵌套结构），就地可变
 * @param options.user - describe 报回来的用户层
 */
function liveSetup({ values = structuredClone(DEFAULTS), user = {} } = {}) {
  const config = {}
  for (const path of Object.values(PATHS)) setPath(config, path, { get: () => pathValue(values, path) })
  config.timeoutMs = DEFAULTS.timeoutMs
  for (const { from } of RETIRED_PATHS) setPath(config, from, { get: () => pathValue(values, from) })
  const calls = []
  const settings = {
    calls,
    // 宿主写完会重读用户层，所以这个 fixture 也要把写入反映到 user 上。
    describe: () => [{ ns: NS, revision: calls.length, user }],
    async mutate(ns, ops, revision) {
      calls.push({ ns, ops, revision })
      for (const op of ops) {
        for (const target of [values, user]) {
          if (op.op === 'set') setPath(target, op.path, op.value)
          else unsetPath(target, op.path)
        }
      }
      return true
    },
  }
  return { config, settings, values }
}

/**
 * 删掉一条嵌套路径，父级空了也不清理：测试只关心叶子在不在。
 * @param object - 根对象
 * @param path - 键名路径
 */
function unsetPath(object, path) {
  let node = object
  for (const key of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return
    node = node[key]
  }
  if (node !== null && typeof node === 'object') delete node[path.at(-1)]
}

test('findDescriptor picks this plugin out of the served namespaces', () => {
  const descriptors = [{ ns: 'other' }, { ns: NS }]
  assert.equal(findDescriptor(descriptors, NS).ns, NS)
  assert.equal(findDescriptor(descriptors, 'missing'), undefined)
})

test('a flat key moves into the nested field and is cleared', () => {
  // 旧键在用户层（0.1/0.2 的页面写进去的就是这里）；config 里的 schema 默认值不算。
  const user = { esPath: 'C:/tools/es.exe', esEncoding: 'utf-8', anytxtUrl: 'http://127.0.0.1:9921' }
  const { ops, keys } = migrationOps(user)
  assert.deepEqual(keys, ['esPath', 'esEncoding', 'anytxtUrl'])
  // 先搬到新位置、再清旧键：settings 只应用了一半时，读侧兜底仍能拿到值。
  assert.deepEqual(ops, [
    { op: 'set', path: PATHS.esPath, value: 'C:/tools/es.exe' },
    { op: 'set', path: PATHS.esEncoding, value: 'utf-8' },
    { op: 'set', path: PATHS.anytxtUrl, value: 'http://127.0.0.1:9921' },
    { op: 'unset', path: ['esPath'] },
    { op: 'unset', path: ['esEncoding'] },
    { op: 'unset', path: ['anytxtUrl'] },
  ])
})

test('a fresh profile migrates nothing, even though the schema fills every retired key', () => {
  // 回归：schema 给退役路径也声明了默认值，按 config 判断会把这几个默认值写进用户层，
  // 并让首用自动配置以为地址已经设过、丢掉 9921 那一次探测。
  assert.deepEqual(migrationOps({}), { ops: [], keys: [] })
  assert.deepEqual(migrationOps(flatConfig()), { ops: [], keys: [] })
})

test('a 0.1 profile jumps straight to the current shape in one startup', () => {
  // v0.1.0 的键与 0.2 是同一批扁平键（九个可编辑 + timeoutMs），所以中间那个版本不需要存在过。
  const user = {
    esPath: 'C:/tools/es.exe',
    esEncoding: 'utf-8',
    anytxtUrl: 'http://127.0.0.1:9921',
    workspaceRoot: 'D:/Alpha',
    workRoot: 'E:/Beta',
    personalRoot: 'F:/Gamma',
    allRoots: 'C:\\;D:\\',
    maxResults: 50,
    readMaxChars: 5000,
    timeoutMs: 12345,
  }
  const { ops, keys } = migrationOps(user)
  assert.deepEqual(keys, [
    'esPath', 'esEncoding', 'anytxtUrl', 'workspaceRoot', 'workRoot',
    'personalRoot', 'allRoots', 'maxResults', 'readMaxChars',
  ])
  assert.equal(ops.filter((op) => op.op === 'set').length, 9)
  assert.equal(ops.filter((op) => op.op === 'unset').length, 9)
  assert.deepEqual(ops.at(0), { op: 'set', path: PATHS.esPath, value: 'C:/tools/es.exe' })
  assert.deepEqual(ops.at(-1), { op: 'unset', path: ['readMaxChars'] })
})

test('a retired path chain folds in publish order, so a multi-version jump works', () => {
  // 下一次形状变更（比如把某个键再改名）只需要在表尾追加一条；这条测试钉住「按顺序折」这件事。
  const retired = [
    { from: ['oldName'], to: ['middle'] },
    { from: ['middle'], to: ['final'] },
  ]
  const { snapshot, filled } = foldRetired({ oldName: 'value' }, undefined, retired)
  assert.equal(snapshot.final, 'value')
  assert.deepEqual(filled, ['middle', 'final'])
})

test('a chain step that is no longer a current path is read but never written', () => {
  // 下次形状变更后，这一版的位置就成了中间路径：它只参与读取兜底，不该再写进 profile。
  const retired = [
    { from: ['oldName'], to: ['middle'] },
    { from: ['middle'], to: PATHS.esPath },
  ]
  const { ops, keys } = migrationOps({ oldName: 'C:/es.exe' }, retired)
  assert.deepEqual(ops, [
    { op: 'set', path: PATHS.esPath, value: 'C:/es.exe' },
    { op: 'unset', path: ['oldName'] },
  ])
  assert.deepEqual(keys, ['oldName'])
})

test('a nested user value is kept and only the flat key is cleared', () => {
  const user = { esPath: 'C:/old/es.exe', files: { everything: { esPath: 'D:/new/es.exe' } } }
  const { ops } = migrationOps(user)
  assert.deepEqual(ops, [{ op: 'unset', path: ['esPath'] }])
})

test('an empty or absent flat key produces no work', () => {
  assert.deepEqual(migrationOps({ esPath: '   ' }), { ops: [], keys: [] })
  assert.deepEqual(migrationOps({}), { ops: [], keys: [] })
})

test('autoconfiguration only runs while a field is still unset', () => {
  assert.equal(autoconfigNeeds(nestedConfig(), {}), true)
  // 用户层已经有 es.exe 路径、地址也换过：没有待填字段。
  assert.equal(autoconfigNeeds(nestedConfig({ files: { everything: { esPath: 'D:/es.exe' } }, content: { anytxt: { url: 'http://127.0.0.1:9921' } } }), {}), false)
  assert.equal(autoconfigNeeds(nestedConfig(), { files: { everything: { esPath: 'D:/es.exe' } }, content: { anytxt: { url: 'http://127.0.0.1:9921' } } }), false)
  // 只填了一项：还有另一项可填。
  assert.equal(autoconfigNeeds(nestedConfig({ files: { everything: { esPath: 'D:/es.exe' } } }), {}), true)
})

test('a detected es.exe path is written back', () => {
  const ops = autoconfigOps(
    { everything: { ok: true, path: 'C:/Program Files/Everything/es.exe' }, anytxt: { ok: true, url: DEFAULTS.content.anytxt.url } },
    nestedConfig(),
    {},
  )
  assert.deepEqual(ops, [{ op: 'set', path: PATHS.esPath, value: 'C:/Program Files/Everything/es.exe' }])
})

test('autoconfiguration never overwrites a value the user already set', () => {
  const ops = autoconfigOps(
    { everything: { ok: true, path: 'C:/es.exe' }, anytxt: { ok: true, url: 'http://127.0.0.1:9921' } },
    nestedConfig(),
    { files: { everything: { esPath: 'D:/mine.exe' } }, content: { anytxt: { url: 'http://127.0.0.1:9921' } } },
  )
  assert.deepEqual(ops, [])
})

test('the 9921 fallback is recorded only when it is what answered', () => {
  const ops = autoconfigOps({ everything: {}, anytxt: { ok: true, url: 'http://127.0.0.1:9921' } }, nestedConfig(), {})
  assert.deepEqual(ops, [{ op: 'set', path: PATHS.anytxtUrl, value: 'http://127.0.0.1:9921' }])
  // 用户已经把地址改到别处：探测结果不再覆盖它。
  const alreadyMoved = nestedConfig({ content: { anytxt: { url: 'http://127.0.0.1:9930' } } })
  assert.deepEqual(autoconfigOps({ everything: {}, anytxt: { ok: true, url: 'http://127.0.0.1:9921' } }, alreadyMoved, {}), [])
})

test('bootstrap migrates first, then writes what the probe found', async () => {
  // 0.2 的 profile：旧键在用户层，嵌套结构还是默认值。
  const { config, settings, values: live } = liveSetup({ user: { esPath: 'C:/old/es.exe' } })
  const probes = []
  const state = await bootstrap({
    settings,
    ns: NS,
    config,
    // 第一次迁移写完之后，es.exe 已经在配置里，于是自动配置不再重复写它，只补地址。
    probe: async (received, options) => {
      probes.push(options)
      return { everything: { ok: true, path: 'C:/new/es.exe' }, anytxt: { ok: true, url: 'http://127.0.0.1:9921' } }
    },
  })
  assert.equal(probes.length, 1)
  assert.equal(probes[0].detail, true)
  assert.equal(settings.calls.length, 2)
  assert.deepEqual(settings.calls[0].ops, [
    { op: 'set', path: PATHS.esPath, value: 'C:/old/es.exe' },
    { op: 'unset', path: ['esPath'] },
  ])
  assert.deepEqual(settings.calls[1].ops, [
    { op: 'set', path: PATHS.anytxtUrl, value: 'http://127.0.0.1:9921' },
    { op: 'set', path: PATHS.autoConfigured, value: true },
  ])
  assert.equal(settings.calls[0].ns, NS)
  // 旧键已经不在配置里，嵌套结构接管。
  assert.equal(live.esPath, undefined)
  assert.equal(live.files.everything.esPath, 'C:/old/es.exe')
  assert.equal(live.content.anytxt.url, 'http://127.0.0.1:9921')
  assert.equal(state.ran, true)
  assert.deepEqual(state.failures, [])
})

test('a configured profile probes nothing and only pins the marker', async () => {
  const values = structuredClone(DEFAULTS)
  const { config, settings } = liveSetup({
    values,
    user: {
      esPath: 'D:/es.exe',
      anytxtUrl: 'http://127.0.0.1:9921',
      files: { everything: { esPath: 'D:/es.exe' } },
      content: { anytxt: { url: 'http://127.0.0.1:9921' } },
    },
  })
  let probes = 0
  const state = await bootstrap({
    settings,
    ns: NS,
    config,
    probe: async () => {
      probes += 1
      return { everything: { ok: true }, anytxt: { ok: true } }
    },
  })
  assert.equal(probes, 0)
  // 第一次照样清掉两个旧键（0.2 的写法），再补上「已经做过决定」的标记。
  assert.equal(settings.calls.length, 2)
  assert.deepEqual(settings.calls[0].ops, [
    { op: 'unset', path: ['esPath'] },
    { op: 'unset', path: ['anytxtUrl'] },
  ])
  assert.deepEqual(settings.calls[1].ops, [{ op: 'set', path: PATHS.autoConfigured, value: true }])
  assert.equal(state.ran, false)
})

test('an 0.3 profile with no flat keys gets the marker and nothing else', async () => {
  const values = nestedConfig({ files: { everything: { esPath: 'D:/es.exe' } }, content: { anytxt: { url: 'http://127.0.0.1:9921' } } })
  const { config, settings } = liveSetup({
    values,
    user: { files: { everything: { esPath: 'D:/es.exe' } }, content: { anytxt: { url: 'http://127.0.0.1:9921' } } },
  })
  let probes = 0
  const state = await bootstrap({
    settings,
    ns: NS,
    config,
    probe: async () => {
      probes += 1
      return { everything: { ok: true }, anytxt: { ok: true } }
    },
  })
  assert.equal(probes, 0)
  assert.equal(settings.calls.length, 1)
  assert.deepEqual(settings.calls[0].ops, [{ op: 'set', path: PATHS.autoConfigured, value: true }])
  assert.equal(state.ran, false)
})

test('the marker locks a later reset, so clearing a field stays cleared', async () => {
  // 用户按「重置」把 esPath 清空之后，下一次启动不该再被自动填回去。
  const values = structuredClone(DEFAULTS)
  values.autoConfigured = true
  const { config, settings } = liveSetup({
    values,
    user: { content: { anytxt: { url: 'http://127.0.0.1:9920' } } },
  })
  let probes = 0
  const state = await bootstrap({
    settings,
    ns: NS,
    config,
    probe: async () => {
      probes += 1
      return { everything: { ok: true, path: 'C:/es.exe' }, anytxt: { ok: true } }
    },
  })
  assert.equal(probes, 0)
  assert.equal(settings.calls.length, 0)
  assert.equal(state.ran, false)
  assert.equal(values.files.everything.esPath, '')
})

test('a down engine is reported, and a cancelled or skipped probe is not a fault', async () => {
  const { config, settings } = liveSetup()
  const state = await bootstrap({
    settings,
    ns: NS,
    config,
    probe: async () => ({
      everything: { ok: false, code: 'EVERYTHING_ABORTED' },
      anytxt: { ok: false, code: 'ANYTXT_DOWN' },
    }),
  })
  assert.deepEqual(state.failures, [{ engine: 'anytxt', code: 'ANYTXT_DOWN' }])
  // 什么也探测不到时只落一个标记：这次就是这次，下回不再打扰。
  assert.equal(settings.calls.length, 1)
  assert.deepEqual(settings.calls[0].ops, [{ op: 'set', path: PATHS.autoConfigured, value: true }])
})

test('a settings conflict is retried once with a fresh revision', async () => {
  // 一次启动里别的插件也在写同一份 profile 文档，而自动配置把探测夹在 describe 与 mutate
  // 之间：revision 变了不该让这次写入直接丢掉。
  const { config, settings, values: live } = liveSetup({ user: { esPath: 'C:/old/es.exe' } })
  const mutate = settings.mutate.bind(settings)
  let conflicts = 0
  settings.mutate = async (ns, ops, revision) => {
    if (conflicts === 0) {
      conflicts += 1
      const error = new Error('settings namespace changed since it was read')
      error.code = 'SETTINGS_CONFLICT'
      throw error
    }
    return mutate(ns, ops, revision)
  }
  const state = await bootstrap({
    settings,
    ns: NS,
    config,
    probe: async () => ({ everything: { ok: true }, anytxt: { ok: true } }),
  })
  assert.equal(conflicts, 1)
  assert.deepEqual(state.written, ['esPath'])
  assert.equal(live.files.everything.esPath, 'C:/old/es.exe')
  assert.equal(state.error, undefined)
})

test('a refused migration write is logged and the startup continues', async () => {
  const warnings = []
  const settings = {
    describe: () => [{ ns: NS, revision: 1, user: { esPath: 'C:/old/es.exe' } }],
    async mutate() {
      throw new Error('overridden by a home patch')
    },
  }
  const state = await bootstrap({
    settings,
    ns: NS,
    config: flatConfig({ esPath: 'C:/old/es.exe' }),
    logger: { warn: (...args) => warnings.push(args) },
    probe: async () => ({ everything: { ok: true }, anytxt: { ok: true } }),
  })
  // 迁移与随后的标记各失败一次，都只降级：旧键留着，readConfig 的回退让它继续生效。
  assert.equal(warnings.length, 2)
  assert.match(String(warnings[0][0]), /migrate/)
  assert.deepEqual(state.written, [])
})

test('a refused autoconfiguration write is logged and the startup continues', async () => {
  const warnings = []
  const settings = {
    describe: () => [{ ns: NS, revision: 1, user: {} }],
    async mutate() {
      throw new Error('overridden by a home patch')
    },
  }
  const state = await bootstrap({
    settings,
    ns: NS,
    config: flatConfig(),
    logger: { warn: (...args) => warnings.push(args) },
    probe: async () => ({ everything: { ok: true, path: 'C:/new/es.exe' }, anytxt: { ok: true } }),
  })
  assert.equal(warnings.length, 1)
  assert.equal(state.ran, true)
})

test('without a served namespace nothing is written', async () => {
  const settings = {
    calls: [],
    describe: () => [],
    async mutate() {
      throw new Error('must not be called')
    },
  }
  const state = await bootstrap({ settings, ns: NS, config: flatConfig({ esPath: 'C:/old/es.exe' }), probe: async () => ({}) })
  assert.deepEqual(state.written, [])
  assert.equal(state.ran, false)
})
