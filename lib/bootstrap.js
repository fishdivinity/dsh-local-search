/**
 * 启动时的两次配置写入：把 0.2 的扁平键搬进嵌套结构，以及首用自动配置。
 *
 * 两者都走 `ctx.settings`：只有它能把值写进 profile 的 `cordis.patch.yml` 并通过 Loader
 * 让 volatile 引用就地更新，不重载插件。写入范围都限定在「用户层还没有值的字段」，
 * 所以幂等，也永远不会覆盖用户已经选过的值。
 *
 * 迁移失败不算致命：profile 被 home patch 覆盖时 settings 会拒绝写入，旧键留在原地，
 * `readConfig` 的回退让它们继续生效。
 */

import { DEFAULTS, PATHS, RETIRED_PATHS, hasPath, pathValue, readConfig, setPath } from './config.js'
import { probeEngines } from './probe.js'

/**
 * 在 settings 的描述里找本插件的命名空间。
 * @param {Array<object>} descriptors - `settings.describe()` 的结果
 * @param {string} ns - profile 行 id
 * @returns {object|undefined} 对应的描述
 */
export function findDescriptor(descriptors, ns) {
  return descriptors.find((descriptor) => descriptor.ns === ns)
}

/**
 * 把退役路径搬进当前结构、再清掉旧键的操作列表。
 *
 * **只认用户层里真的存在的旧路径**。schema 给退役路径也声明了默认值，所以「配置里有值」不等于
 * 「用户写过」——按配置判断会把 `esEncoding` / `anytxtUrl` / `maxResults` / `readMaxChars` 四个
 * 默认值写进 profile，并让首用自动配置以为地址已经设过，从而丢掉 9921 那一次探测。
 *
 * 链式迁移在同一次调用里跑完：上一段的 `to` 是下一段的 `from`，所以「0.1 直装 1.0」不需要中间
 * 版本存在过。链上的中间路径只搬不写（写进去也没人读）；先写新位置再清旧键，settings 只应用了
 * 一半时读侧兜底仍拿得到值。
 * @param user - 设置表单的用户层
 * @param retired - 退役路径表，测试可注入
 * @returns {{ops: Array<object>, keys: string[]}} 操作列表与清掉的旧路径
 */
export function migrationOps(user = {}, retired = RETIRED_PATHS) {
  const staged = {}
  const carried = []
  for (const { from, to } of retired) {
    // 用户层里有这个旧路径就用它；否则接着链上一步放在 `staged` 里的值。
    const value = hasPath(user, from) ? pathValue(user, from) : pathValue(staged, from)
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    setPath(staged, to, value)
    carried.push(to.join('.'))
  }
  const currentPaths = new Set(Object.values(PATHS).map((path) => path.join('.')))
  const ops = []
  const keys = []
  for (const pathKey of carried) {
    if (!currentPaths.has(pathKey)) continue
    const path = pathKey.split('.')
    if (hasPath(user, path)) continue
    const value = pathValue(staged, path)
    if (value === undefined) continue
    ops.push({ op: 'set', path, value })
  }
  for (const { from } of retired) {
    // 只有用户层里真的存在、且不是空白的旧键才需要清；schema 默认值不算。
    if (!hasPath(user, from)) continue
    const value = pathValue(user, from)
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    keys.push(from.join('.'))
    ops.push({ op: 'unset', path: from })
  }
  return { ops, keys }
}

/**
 * 写一次设置，撞上并发修改就重读 revision 再试一次。
 *
 * 自动配置把「探测」夹在 `describe()` 与 `mutate()` 之间（一次 es.exe + 一次 HTTP），这段时间
 * 里谁在页面上点了保存，我们的 revision 就过期（`SETTINGS_CONFLICT`）。重放安全——ops 只碰
 * 用户层还没设过的字段。
 *
 * 命名空间消失时抛错而不是静默返回：那条消息是「写回为什么没发生」唯一的线索。
 * @param {object} settings - Host 的 settings 服务
 * @param {string} ns - profile 行 id
 * @param {Array<object>} ops - 设置操作列表
 */
async function writeSettings(settings, ns, ops) {
  const descriptor = findDescriptor(settings.describe(), ns)
  if (descriptor === undefined) throw new Error(`settings namespace "${ns}" is not available`)
  try {
    await settings.mutate(ns, ops, descriptor.revision)
  } catch (error) {
    if (error?.code !== 'SETTINGS_CONFLICT') throw error
    const retried = findDescriptor(settings.describe(), ns)
    if (retried === undefined) throw error
    await settings.mutate(ns, ops, retried.revision)
  }
}

/**
 * 是否还有值得探测的东西。
 *
 * 没有待填字段就完全不探测：一次探测要花一次 es.exe 启动和一次 HTTP 请求，配置齐了就不该
 * 在每次启动时付这个成本。
 * @param {object} values - 配置快照
 * @param {object} user - 设置表单的用户层
 * @returns {boolean} 需要探测时为 true
 */
export function autoconfigNeeds(values, user) {
  const wantsEsPath = !hasPath(user, PATHS.esPath) && !values.files.everything.esPath
  const wantsUrl = !hasPath(user, PATHS.anytxtUrl) && values.content.anytxt.url === DEFAULTS.content.anytxt.url
  return wantsEsPath || wantsUrl
}

/**
 * 探测结果里可以写回去的字段。
 * @param {{everything: object, anytxt: object}} probed - 探测结果
 * @param {object} values - 配置快照
 * @param {object} user - 设置表单的用户层
 * @returns {Array<object>} 设置操作列表
 */
export function autoconfigOps(probed, values, user) {
  const ops = []
  const everythingPath = probed.everything?.ok ? probed.everything.path : undefined
  if (typeof everythingPath === 'string' && everythingPath !== '') {
    if (!hasPath(user, PATHS.esPath) && !values.files.everything.esPath) {
      ops.push({ op: 'set', path: PATHS.esPath, value: everythingPath })
    }
  }
  // 只在探测真的落到 9921 回退口时才写地址：默认值本身写回去没有信息量。
  const anytxtUrl = probed.anytxt?.ok ? probed.anytxt.url : undefined
  if (typeof anytxtUrl === 'string' && anytxtUrl !== '' && anytxtUrl !== DEFAULTS.content.anytxt.url) {
    if (!hasPath(user, PATHS.anytxtUrl) && values.content.anytxt.url === DEFAULTS.content.anytxt.url) {
      ops.push({ op: 'set', path: PATHS.anytxtUrl, value: anytxtUrl })
    }
  }
  return ops
}

/** 探测失败且值得告诉用户的引擎。取消与跳过是部署事实，不是故障。 */
function probeFailures(probed) {
  const failures = []
  for (const engine of ['everything', 'anytxt']) {
    const status = probed[engine] ?? {}
    if (status.ok) continue
    const code = String(status.code ?? 'UNKNOWN')
    if (code === 'SKIPPED' || code.endsWith('_ABORTED')) continue
    failures.push({ engine, code })
  }
  return failures
}

/**
 * 执行一次启动配置：先迁移旧键，再按需探测并写回。
 * @param {object} options
 * @param {object} options.settings - Host 的 settings 服务
 * @param {string} options.ns - profile 行 id（= 设置命名空间）
 * @param {object} options.config - schema 输出，含活引用
 * @param {object} [options.logger] - 有 `warn` 时迁移失败会记一条
 * @param {Function} [options.probe] - 可注入的探测函数
 * @param {object} [options.state] - 会被就地更新的描述载荷
 * @returns {Promise<object>} 同一个 state
 */
export async function bootstrap({ settings, ns, config, logger, probe = probeEngines, state = {} }) {
  const target = Object.assign({ ran: false, written: [], failures: [] }, state)
  try {
    const descriptor = findDescriptor(settings.describe(), ns)
    if (descriptor === undefined) return target
    const { ops, keys } = migrationOps(descriptor.user)
    if (ops.length > 0) {
      await writeSettings(settings, ns, ops)
      target.written.push(...keys)
    }
  } catch (error) {
    target.error = String(error?.message ?? error)
    logger?.warn?.('dsh-local-search: could not migrate the flat config keys', error)
  }
  try {
    const values = readConfig(config)
    const descriptor = findDescriptor(settings.describe(), ns)
    if (descriptor === undefined) return target
    // 已经做过决定就再不碰：用户清空的字段必须能保持空着，否则「重置」形同虚设。
    if (values.autoConfigured === true) return target
    if (!autoconfigNeeds(values, descriptor.user)) {
      // 配置本来就齐：只补标记，免得以后清空某个字段又被自动写回。
      await writeSettings(settings, ns, [{ op: 'set', path: PATHS.autoConfigured, value: true }])
      target.written.push(PATHS.autoConfigured.at(-1))
      return target
    }
    target.ran = true
    const probed = await probe(config, { detail: true })
    target.failures = probeFailures(probed)
    const ops = autoconfigOps(probed, values, descriptor.user)
    // 标记与值同一次落盘：哪怕这次什么也没探测到，也只做这一次决定。
    ops.push({ op: 'set', path: PATHS.autoConfigured, value: true })
    await writeSettings(settings, ns, ops)
    target.written.push(...ops.slice(0, -1).map((op) => op.path.at(-1)))
  } catch (error) {
    target.error = String(error?.message ?? error)
    logger?.warn?.('dsh-local-search: first-run autoconfiguration failed', error)
  }
  return target
}
