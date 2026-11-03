/**
 * 配置的路径表、默认值与读取规则。
 *
 * 路径只在这里写一遍：schema、页面描述、迁移、自动配置都从 `PATHS` 取；退役的旧路径在
 * `RETIRED_PATHS` 里，只追加不改写（规则见 `docs/config-migration.md`）。
 * 页面能改的字段在 schema 里标了 `.volatile()`，`apply` 拿到的是活引用；下游不许留着它，每个
 * 操作都从 {@link readConfig} 的纯快照出发。`timeoutMs` 不在 `PATHS` 里：`defineTool` 在注册时
 * 就固定了截止时间，新值只能靠重载生效。
 */

/** 可编辑字段的嵌套路径；键名是代码里的称呼，值是配置里的位置。 */
export const PATHS = {
  filesBackend: ['files', 'backend'],
  esPath: ['files', 'everything', 'esPath'],
  esEncoding: ['files', 'everything', 'esEncoding'],
  contentBackend: ['content', 'backend'],
  anytxtUrl: ['content', 'anytxt', 'url'],
  workspaceRoot: ['scopes', 'workspaceRoot'],
  workRoot: ['scopes', 'workRoot'],
  personalRoot: ['scopes', 'personalRoot'],
  allRoots: ['scopes', 'allRoots'],
  defaultScope: ['scopes', 'defaultScope'],
  maxResults: ['limits', 'maxResults'],
  readMaxChars: ['limits', 'readMaxChars'],
  checkEnginesOnStart: ['checkEnginesOnStart'],
  autoConfigured: ['autoConfigured'],
}

/**
 * 字段默认值。schema 从这里取默认值，`readConfig` 也用它补齐缺失层级，
 * 所以一份不完整的 profile 不会读出一堆 `undefined`。
 */
export const DEFAULTS = {
  files: { backend: 'everything', everything: { esPath: '', esEncoding: 'gbk' } },
  content: { backend: 'anytxt', anytxt: { url: 'http://127.0.0.1:9920' } },
  scopes: { workspaceRoot: '', workRoot: '', personalRoot: '', allRoots: '', defaultScope: 'all' },
  limits: { maxResults: 20, readMaxChars: 8000 },
  // 每次启动探一次引擎、有失败就在右下角提示；关掉既不探也不提示（手动「测试连接」不受影响）。
  checkEnginesOnStart: true,
  // 首用自动配置是否已经做过决定：写死之后，用户清空的字段不会再被自动填回去。
  autoConfigured: false,
  timeoutMs: 30000,
}

/**
 * 已退役的路径 → 现在的位置。
 *
 * **一条 = 一次形状变更**，按发布顺序追加，永远不删、不改号；`from` 写当时的字面路径（不引用
 * {@link PATHS}），否则将来改 PATHS 会把这行历史一起改掉。三条消费方都只读这张表：读取兜底、
 * schema 里的隐藏旧键、启动迁移。规则与取舍见 `docs/config-migration.md`。
 */
export const RETIRED_PATHS = [
  { from: ['esPath'], to: PATHS.esPath },
  { from: ['esEncoding'], to: PATHS.esEncoding },
  { from: ['anytxtUrl'], to: PATHS.anytxtUrl },
  { from: ['workspaceRoot'], to: PATHS.workspaceRoot },
  { from: ['workRoot'], to: PATHS.workRoot },
  { from: ['personalRoot'], to: PATHS.personalRoot },
  { from: ['allRoots'], to: PATHS.allRoots },
  { from: ['maxResults'], to: PATHS.maxResults },
  { from: ['readMaxChars'], to: PATHS.readMaxChars },
]

/**
 * 读一个可能仍是活引用的值。
 * @param {unknown} value - 普通值，或带 `get()` 的引用
 * @returns {unknown} 当前值
 */
export function liveValue(value) {
  return typeof value?.get === 'function' ? value.get() : value
}

/**
 * 沿路径取一个值。
 * @param {object} object - 根对象，可为 undefined
 * @param {string[]} path - 键名路径
 * @returns {unknown} 命中值，或 undefined
 */
export function pathValue(object, path) {
  let node = object
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined
    // 逐层解引用：schema 把 volatile 标在叶子上，但一份被外部包装过的配置可能整棵都是引用。
    node = liveValue(node[key])
  }
  return node
}

/**
 * 沿路径写一个值，中间层级按需创建。
 * @param {object} object - 将被就地修改的根对象
 * @param {string[]} path - 键名路径
 * @param {unknown} value - 要写入的值
 */
export function setPath(object, path, value) {
  let node = object
  for (const key of path.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[path.at(-1)] = value
}

/**
 * 路径是否由该层自己提供的键组成（不看继承值）。
 * @param {object} object - 根对象，可为 undefined
 * @param {string[]} path - 键名路径
 * @returns {boolean} 每一层都显式带这个键时为 true
 */
export function hasPath(object, path) {
  let node = object
  for (const key of path) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, key)) return false
    node = node[key]
  }
  return true
}

/** 深拷贝一份默认值，免得调用方改到共享常量。 */
function defaults() {
  return structuredClone(DEFAULTS)
}

/**
 * 这个路径上的值算不算「还没设过」：缺失、空串，或仍等于默认值。
 *
 * 迁移链上的中间位置在 {@link DEFAULTS} 里没有记录，那时只有缺失与空串算没设过。
 */
function isUnset(snapshot, path) {
  const value = pathValue(snapshot, path)
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  const fallback = pathValue(DEFAULTS, path)
  return fallback !== undefined && String(value) === String(fallback)
}

/**
 * 把退役路径上的值按发布顺序折进快照。
 *
 * 顺序就是执行顺序：更早的一次迁移先把值放到它的 `to`（对当前结构来说是中间位置），后一次再
 * 从那里搬到当前路径。所以跨多个版本直装不需要中间版本存在过——这条链在同一次启动里跑完。
 * @param config - schema 输出，含活引用
 * @param snapshot - 已经按当前路径填过的快照，会被就地修改
 * @param retired - 退役路径表，测试可注入
 * @returns 快照与被旧路径填过的当前路径（点分）
 */
export function foldRetired(config, snapshot = defaults(), retired = RETIRED_PATHS) {
  const filled = []
  for (const { from, to } of retired) {
    // 先看 profile 里的旧路径，再看快照：链上更早的一次迁移会把值放在快照的中间路径上。
    let value = pathValue(config, from)
    if (value === undefined || value === null) value = pathValue(snapshot, from)
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (!isUnset(snapshot, to)) continue
    setPath(snapshot, to, value)
    filled.push(to.join('.'))
  }
  return { snapshot, filled }
}

/**
 * 当前结构 + 退役路径折过之后的快照。
 *
 * 读侧只是兜底：旧键上恰好等于默认值也不影响结果（同一个值）。要防的是迁移把它当成用户写的值
 * 写回 profile——那件事在 `lib/bootstrap.js` 里按**用户层**判定，不靠这里。
 * @param {object} config - schema 输出，含活引用
 * @returns {object} 本次操作可用的纯值
 */
export function readConfig(config) {
  const snapshot = defaults()
  for (const path of Object.values(PATHS)) {
    const value = pathValue(config, path)
    if (value !== undefined) setPath(snapshot, path, value)
  }
  // 退役路径只在目标位置还是默认值时补位：迁移成功后就清掉了，没清掉说明 settings 写不进去
  // （home patch 覆盖），那时它仍是唯一来源。
  foldRetired(config, snapshot)
  const timeoutMs = liveValue(config?.timeoutMs)
  if (timeoutMs !== undefined) snapshot.timeoutMs = timeoutMs
  return snapshot
}

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`dsh-local-search: ${field} must be a positive integer`)
  }
}

function assertBackend(field, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-local-search: ${field} must name a backend`)
  }
}

/** 只认本机的 host 表。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * 值是否是指向本机的 `http(s)` 地址。
 *
 * 两个索引都描述这台机器：`es.exe` 在这里启动，Anytxt 的每条结果都带一个只在这里成立的
 * 路径。远端地址会返回另一台机器的路径，因此拒绝而不是支持——把远端隧道进来最终仍落在
 * loopback 上。
 * @param {unknown} value - 待检查的地址
 * @returns {boolean} 本机 `http(s)` 地址时为 true
 */
export function isLoopbackUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value))
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return LOOPBACK_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, ''))
}

/**
 * 校验一份配置并返回它的纯快照。激活时跑一次；页面写入由 Host 按 Config schema 校验后才落盘，
 * 所以这里只覆盖 schema 表达不了的部分。
 * endpoint 的 loopback 规则故意不在这里执行：地址写错应该让内容引擎报一个能读懂的错误，而不是
 * 把文件名检索一起拖下水，规则留在用到它的地方（`lib/anytxt.js`）。
 * @param {object} config - schema 输出，含活引用
 * @param {number} [maxTimerDelayMs] - 定时器 API 接受的最大截止时间
 * @returns {object} 校验过的纯快照
 */
export function validateConfig(config, maxTimerDelayMs) {
  const values = readConfig(config)
  assertBackend('files.backend', values.files.backend)
  assertBackend('content.backend', values.content.backend)
  if (!['all', 'workspace', 'work', 'personal'].includes(values.scopes.defaultScope)) {
    throw new Error('dsh-local-search: scopes.defaultScope must be all, workspace, work or personal')
  }
  assertPositiveInteger('limits.maxResults', values.limits.maxResults)
  assertPositiveInteger('limits.readMaxChars', values.limits.readMaxChars)
  assertPositiveInteger('timeoutMs', values.timeoutMs)
  if (maxTimerDelayMs !== undefined && values.timeoutMs > maxTimerDelayMs) {
    throw new Error(`dsh-local-search: timeoutMs must be no greater than ${maxTimerDelayMs}`)
  }
  return values
}
