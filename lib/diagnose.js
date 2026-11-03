/**
 * 给人看的诊断文本：把调用方注入的事实排成一段可复制的纯文本，用户贴进 issue 就能说清现场。
 *
 * 不探测、不 spawn、不读环境——引擎状态、根、版本都由调用方给，单测不需要真机。它与
 * `lib/format.js` 的 `formatStatus` 是两份不同的输出：那份只回答模型「能不能用」（`ok` /
 * `code` / `message`），这份回答用户「为什么、哪台机器、什么时候」。版本、平台与修法只许走
 * 这条路，混进工具返回会诱使模型把一次检索失败升级成一次环境排查。
 */

import { engineLabel } from './labels.js'
import { isFailure } from './status.js'

/** 四态 → 给人看的词。 */
const STATE_LABELS = {
  ready: 'OK',
  'missing-tool': 'MISSING-TOOL',
  'missing-index': 'MISSING-INDEX',
  down: 'DOWN',
}

/** 失败行的细分类 → 一句自解释的话；读的人不必知道内部代号。 */
const DETAIL_WORDS = {
  'not-running': 'not running',
  'not-installed': 'not installed',
  'es-missing': 'es.exe missing',
  unknown: 'install unknown',
}

/** 这份文本离开仓库时要带上的唯一指针：code → 修法的表在那里。 */
const DOCS_URL = 'https://github.com/fishdivinity/dsh-local-search/blob/main/docs/troubleshooting.md'

/**
 * `config:` 那一行写哪些键、各自从配置快照的哪里取。
 *
 * 装配点（`lib/index.js`）调 {@link configFacts}，渲染按同一份顺序输出——加一个配置键只改这张表，
 * 不会出现「schema 里有、诊断文本漏了」。
 * @type {Array<[string, (config: object) => unknown]>}
 */
export const CONFIG_FACTS = [
  ['esPath', (config) => config.files.everything.esPath || '(auto)'],
  ['esEncoding', (config) => config.files.everything.esEncoding],
  ['anytxtUrl', (config) => config.content.anytxt.url],
  ['timeoutMs', (config) => config.timeoutMs],
  ['checkEnginesOnStart', (config) => config.checkEnginesOnStart !== false],
  ['maxResults', (config) => config.limits.maxResults],
  ['readMaxChars', (config) => config.limits.readMaxChars],
  ['filesBackend', (config) => config.files.backend],
  ['contentBackend', (config) => config.content.backend],
]

/**
 * 按 {@link CONFIG_FACTS} 从一份配置快照取出诊断要用的值。
 * @param {object} config - `readConfig` 的纯快照
 * @returns {object} 键顺序与 {@link CONFIG_FACTS} 一致
 */
export function configFacts(config) {
  const facts = {}
  for (const [key, read] of CONFIG_FACTS) facts[key] = read(config)
  return facts
}

/**
 * 失败行上的细分类。只写读得懂的话，而且只在它真的增加信息时才写：
 * Anytxt 的 `unknown` 在超时那类错误上只是「判断不了」，写出来反而误导。
 * @param {string} label - 引擎显示名
 * @param {object} status - 探测结果
 * @returns {string} 带前导空格的标签，或空串
 */
function detailToken(label, status) {
  const detail = text(status.detail)
  if (detail === undefined) return ''
  if (label === 'Anytxt') {
    if (detail === 'not-running') return ' [installed, not running]'
    if (detail === 'unknown' && status.code === 'ANYTXT_DOWN') return ' [install not found]'
    return ''
  }
  const words = DETAIL_WORDS[detail]
  return words === undefined ? '' : ` [${words}]`
}

/** 非空字符串才算有值；缺的字段整段不出现，而不是写 `unknown=` 占位。 */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 秒级 ISO：毫秒是噪音，读的人只关心是哪一刻。 */
function seconds(value) {
  const raw = text(value)
  if (!raw) return undefined
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.toISOString().slice(0, 19)}Z`
}

/** 比较前的分隔符规范化：`/` 折成 `\`。必须等长——调用方按原串的下标切片。 */
const toKey = (text) => text.replace(/\//g, '\\')

/**
 * 把一段文本里所有出现的前缀换成 `~`。
 *
 * 不能只比开头：引擎 message 常把路径写在句子中间。Windows 上 `C:/Home/me` 与 `C:\Home\me`
 * 是同一个路径，比较时把 `/` 折成 `\`；替换是 1:1 的，切原串保留原来的分隔符。
 * @param {string} value - 要脱敏的文本
 * @param {string} rule - 已去掉尾分隔符的前缀
 * @param {boolean} caseInsensitive - 是否按不区分大小写比
 * @returns {string} 脱敏后的文本
 */
function maskOne(value, rule, caseInsensitive) {
  if (rule === '') return value
  const haystack = toKey(caseInsensitive ? value.toLowerCase() : value)
  const needle = toKey(caseInsensitive ? rule.toLowerCase() : rule)
  let out = ''
  let from = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    const after = haystack[at + needle.length]
    const before = at > 0 ? haystack[at - 1] : undefined
    // 右边界：后面是结尾或分隔符，`C:\Home\me` 不能吃掉 `C:\Home\me2`——那是另一个用户。
    // 左边界：前面不能是路径字符，否则长路径里恰好出现的一段也会被改写。
    const boundary = (after === undefined || after === '\\') &&
      (before === undefined || !/[\\\w]/.test(before))
    if (boundary) {
      // 前缀后面紧跟的分隔符改成 `/`：`<home>\doc` → `~/doc`，与路径表里的 `~` 写法一致。
      const skip = after === '\\' ? 1 : 0
      out += `${value.slice(from, at)}~${skip === 1 ? '/' : ''}`
      from = at + needle.length + skip
    }
    at = haystack.indexOf(needle, at + 1)
  }
  return out + value.slice(from)
}

/**
 * 造一个脱敏函数：把用户目录与 DSH_HOME 的前缀换成 `~`。
 *
 * 顺序是 `dshHome` 先、`home` 后：DSH_HOME 常常就在 home 下面，反过来先换 home 就再也认不出
 * 更长的那一条。Windows 上按不区分大小写比：配置里写的大小写可能与 `os.homedir()` 不同，漏换
 * 一次就把用户名贴进 issue 了；其余分隔符与写法原样保留，改写会让人认不出自己的路径。
 * @param {{home?: string, dshHome?: string, caseInsensitive?: boolean}} prefixes - 要换掉的前缀
 * @returns {(value: string) => string} 脱敏函数（非字符串原样返回）
 */
function makeMask({ home, dshHome, caseInsensitive = false }) {
  const rules = [dshHome, home]
    .map((prefix) => (typeof prefix === 'string' ? prefix.replace(/[\\/]+$/, '') : ''))
    .filter(Boolean)
  return (value) => {
    if (typeof value !== 'string' || value === '') return value
    let result = value
    for (const rule of rules) result = maskOne(result, rule, caseInsensitive)
    return result
  }
}

/**
 * 探测结果的四态。
 *
 * `probeEngines` 只在 `detail: true` 时带 `state`，只给模型的那份只有 `ok`；两个都认，一个漏传
 * `detail` 的调用方不该把健康的引擎印成 DOWN。
 */
function stateOf(status) {
  return text(status.state) ?? (status.ok ? 'ready' : 'down')
}

/**
 * 一个引擎的状态行。
 *
 * 取消是这次调用被中止、跳过是根本没探，两者都不说明索引坏了：报成 DOWN 会把人送去查错的
 * 地方，所以沿用 `formatStatus` 的读法（`ABORTED — CODE` / `SKIPPED — message`）。
 * @param {string} label - 引擎的显示名
 * @param {object} status - 探测结果
 * @param {(value: string) => string} mask - 脱敏函数
 * @returns {string} 这一行
 */
function engineLine(label, status, mask) {
  const code = text(status.code)
  // 跳过与取消不是故障：沿用 `formatStatus` 的读法，三处判据都走 `isFailure`。
  if (!status.ok && !isFailure(status)) {
    if (code === 'SKIPPED') return `${label}: SKIPPED${status.message ? ` — ${mask(status.message)}` : ''}`
    return `${label}: ABORTED — ${code}`
  }

  const state = stateOf(status)
  // 失败项多一个自解释的细分类：它把「没在运行」「缺 es.exe」「装没装的判断不了」分开。
  const tag = state === 'ready' ? '' : detailToken(label, status)
  const head = `${label}: ${STATE_LABELS[state] ?? state.toUpperCase()}${tag}`
  if (state === 'ready') {
    const where = status.path ? ` via ${mask(String(status.path))}` : status.url ? ` at ${status.url}` : ''
    return `${head}${status.version ? ` (${status.version})` : ''}${where}`
  }
  const message = text(status.message)
  const why = code && message ? `${code}: ${message}` : code || message
  // 失败时也说清试的是哪个地址；回退口试过多个时一并列出，否则「端口写错」排不掉。
  const tried = Array.isArray(status.tried) ? status.tried.map((entry) => text(entry)).filter(Boolean) : []
  const where = text(status.url)
    ? ` at ${mask(String(status.url))}${tried.length > 1 ? ` (tried ${tried.map((entry) => mask(entry)).join(', ')})` : ''}`
    : ''
  return why ? `${head} — ${mask(why)}${where}` : `${head}${where}`
}

/** 一个 scope 的值：脱敏后的路径，空值写 `(unset)`。 */
function rootValue(value, mask) {
  const path = text(value)
  return path ? mask(path) : '(unset)'
}

/**
 * 构造一份可复制的诊断文本：调用方注入哪些事实就写哪些，缺的整段不出现。
 *
 * 输入字段见 `lib/index.js` 的调用点；`home` / `dshHome` 用来把家目录换成 `~`。
 * @param {object} [input] - plugin / dsh / shell / profile / remote / os / engines / roots /
 *   config / autoconfig / home / dshHome / checkedAt
 * @returns {string} 多行纯文本（UTF-8）
 */
export function diagnose(input = {}) {
  const mask = makeMask({
    home: input.home,
    dshHome: input.dshHome,
    caseInsensitive: input.os?.platform === 'win32',
  })
  const lines = []

  const plugin = text(input.plugin)
  // 标题让任何读者（人或 AI）第一眼知道这是什么、谁写的；版本可缺，不写空括号。
  if (plugin) lines.push(`# dsh-local-search diagnostics (${plugin})`)

  // DSH 版本只有页面知道，标出来源：读者才知道该怀疑的是页面那半边还是 Host。
  const dsh = text(input.dsh)
  if (dsh) lines.push(`dsh ${dsh} (reported by the page)`)

  const facts = [
    ['shell', input.shell],
    ['profile', input.profile],
    ['remote', input.remote],
  ]
    .map(([key, value]) => [key, text(value)])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
  if (facts.length > 0) lines.push(facts.join('  '))

  const os = input.os && typeof input.os === 'object' ? input.os : undefined
  if (os) {
    const parts = []
    const system = [text(os.platform), text(os.release)].filter(Boolean)
    if (system.length > 0) parts.push(`os=${system.join(' ')}`)
    if (text(os.node)) parts.push(`node=${os.node}`)
    if (parts.length > 0) lines.push(parts.join('  '))
  }

  const engineLines = []
  let legend = false
  for (const [name, status] of Object.entries(input.engines ?? {})) {
    if (status === null || typeof status !== 'object') continue
    const label = engineLabel(name)
    engineLines.push(engineLine(label, status, mask))
    if (stateOf(status) !== 'ready' && detailToken(label, status) !== '') legend = true
  }
  lines.push(...engineLines)

  const roots = input.roots && typeof input.roots === 'object' ? input.roots : undefined
  if (roots) {
    const parts = ['workspace', 'work', 'personal'].map((scope) => `${scope}=${rootValue(roots[scope], mask)}`)
    const all = (Array.isArray(roots.all) ? roots.all : [])
      .map((root) => text(root))
      .filter(Boolean)
      .map(mask)
    parts.push(`all=${all.length > 0 ? all.join(',') : '(unset)'}`)
    // 不写 scope 时到底搜哪个：这是「为什么它搜了 D 盘 / 为什么这么慢」的答案。
    if (text(roots.default)) parts.push(`default=${text(roots.default)}`)
    lines.push(`roots: ${parts.join('  ')}`)
  }

  // 配置值本身：没有它，「地址写错了」和「服务没开」在文本里长得一样。
  if (input.config && typeof input.config === 'object') {
    const parts = []
    for (const [key, value] of Object.entries(input.config)) {
      if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key}=${value}`)
      else if (text(value)) parts.push(`${key}=${mask(String(value))}`)
    }
    if (parts.length > 0) lines.push(`config: ${parts.join('  ')}`)
  }

  if (input.autoconfig && typeof input.autoconfig === 'object') {
    const ran = typeof input.autoconfig.ran === 'boolean'
    const deferred = typeof input.autoconfig.deferred === 'boolean'
    const error = text(input.autoconfig.error)
    if (ran || deferred || error) {
      const parts = []
      if (ran) parts.push(`ran=${input.autoconfig.ran}`)
      if (deferred) parts.push(`deferred=${input.autoconfig.deferred}`)
      // 页面会显示这条错误；复制出来的文本没有它，「页面知道而文本不知道」就成了排查盲区。
      if (error) parts.push(`error=${mask(error)}`)
      lines.push(`first-run: ${parts.join('  ')}`)
    }
  }

  // 只留「什么时候探的」：哪个后端挂了已经写在上面那几行里，再列一遍是重复。
  const checked = seconds(input.checkedAt)
  if (checked) lines.push(`checked-at: ${checked}`)

  // 文本离开仓库后，读者（人或 AI）需要这两行才能自己走完排查。它们属于「一份完整文档」，
  // 只有带标题时（真实调用点总会带上 plugin）才写，单测里的片段输出保持干净。
  if (plugin !== undefined) {
    if (legend) {
      lines.push('legend: [not running] = installed but not answering; [es.exe missing] = the command-line tool is absent; [install not found] = not in the usual install folders')
    }
    if (engineLines.length > 0) lines.push(`docs: ${DOCS_URL}`)
  }

  return lines.join('\n')
}
