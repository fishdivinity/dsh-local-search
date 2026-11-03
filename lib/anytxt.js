import { existsSync } from 'node:fs'
import { EngineError } from './errors.js'
import { DEFAULTS, isLoopbackUrl } from './config.js'
import { PROBE_MIN_MS } from './limits.js'
import { detect } from './platform.js'

// 默认地址只有 `lib/config.js` 的 DEFAULTS 一份；这里只是别名，别把 URL 再写一遍。
const DEFAULT_URL = DEFAULTS.content.anytxt.url
/** 默认端口，以及部分 Anytxt 构建放在下一号上的回退口。 */
const DEFAULT_PORT = new URL(DEFAULT_URL).port
const FALLBACK_PORT = '9921'
const EXCLUDED = [/\\\$RECYCLE\.BIN\\/i, /\\System Volume Information\\/i]
const RPC_TIMEOUT_MS = 15000
/** 不是“纯文件名”的查询：带操作符、通配符或路径分隔符。 */
const QUERY_SYNTAX = /[&|!()"*?\\/]/

/**
 * 探测时问哪个根。
 *
 * 探测只是要一个「索引答不答话」的信号，根取这个平台的默认根（Windows 的第一个存在盘根、
 * Linux 的 `/home`、macOS 的 `/Users`）。这里不再读 `process.env.SystemDrive`：平台默认值
 * 只从 `lib/platform.js` 出。
 * @returns {string} 一个存在的目录
 */
function defaultProbeRoot() {
  const platform = detect()
  return platform.defaultAllRoots[0] ?? platform.home ?? process.cwd()
}

/**
 * ATGUI.exe 的常见安装位置，按优先级排列。
 *
 * 只用来回答「大概率装了没有」：便携版和自定义安装目录不在表里，所以找不到时不下结论（见
 * {@link anytxtInstalled}）。
 * @returns {string[]} 候选路径
 */
export function anytxtCandidates() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA || ''
  return [
    `${programFiles}\\Anytxt Searcher\\ATGUI.exe`,
    `${programFilesX86}\\Anytxt Searcher\\ATGUI.exe`,
    localAppData ? `${localAppData}\\Programs\\Anytxt Searcher\\ATGUI.exe` : '',
  ].filter(Boolean)
}

/**
 * Anytxt 大概率装了没有。
 *
 * 找到 `ATGUI.exe` 才算证据；找不到可能是便携版或装在别处，所以返回 `null`（不知道），而不是
 * `false`。探测只在「端口没人应答」时用它把「没启动」和「没装」分开。
 * @returns {boolean|null} `true` 找到；`null` 不知道
 */
export function anytxtInstalled() {
  return anytxtCandidates().some((candidate) => existsSync(candidate)) ? true : null
}

/**
 * 主地址，加上某些 Anytxt 构建会用的 9921 回退口。
 *
 * loopback 规则就住在这里：地址是每次调用现读的，所以一份仍写着另一台机器的 profile 只会让
 * 内容检索失败，并给出一个模型能解释的 code——而不是让激活失败、把文件名检索一起拖下水。
 * @param url - 配置的地址
 * @returns 要依次尝试的地址
 * @throws {EngineError} 地址不是本机时抛 ANYTXT_ENDPOINT_REMOTE
 */
export function resolveAnytxtUrls(url = DEFAULT_URL) {
  const base = String(url || DEFAULT_URL).replace(/\/+$/, '')
  if (!isLoopbackUrl(base)) {
    throw new EngineError(`Anytxt endpoint must be local, not ${base}`, 'ANYTXT_ENDPOINT_REMOTE', {
      hint: 'Both indexes describe this machine, so the endpoint must be 127.0.0.1, localhost or [::1].',
    })
  }
  const urls = [base]
  // 只有地址用的就是默认端口时才试回退口：用户自选的端口不该被我们擅自换掉。
  if (new URL(base).port === DEFAULT_PORT) {
    const fallback = new URL(base)
    fallback.port = FALLBACK_PORT
    urls.push(fallback.toString().replace(/\/$/, ''))
  }
  return urls
}

/** 带引号的短语走精确模式（st=1），其余查询走高级模式。 */
export function quoteAware(query) {
  const trimmed = String(query ?? '').trim()
  if (/^".*"$/s.test(trimmed)) {
    return { pattern: trimmed.slice(1, -1), st: '1' }
  }
  return { pattern: trimmed, st: '2' }
}

/** 去掉 Anytxt 在片段里加的命中高亮标记。 */
export function stripHighlights(text) {
  return String(text ?? '').replace(/\*<<\*|\*>>\*/g, '')
}

function parseFileTuple(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 4) return undefined
  const [fid, lastModify, size, file] = tuple
  if (typeof file !== 'string' || EXCLUDED.some((re) => re.test(file))) return undefined
  const numericSize = Number(size)
  const numericModified = Number(lastModify)
  const item = {
    ref: String(fid),
    path: file,
  }
  if (Number.isFinite(numericSize)) item.size = numericSize
  if (Number.isFinite(numericModified) && numericModified > 0) {
    item.modified = new Date(numericModified * 1000).toISOString()
  }
  return item
}

/** `a/b/c.txt` → `c.txt` 与 `c`；两种分隔符都认，不依赖宿主的 path 规则。 */
function nameParts(file) {
  const base = String(file).split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return { base, stem: dot > 0 ? base.slice(0, dot) : base }
}

/**
 * 查询是不是这个文件的完整名字。
 *
 * 只认纯名字：带 `& | ! ( ) " * ?` 或路径分隔符的查询是表达式/路径，不拿它比文件名。
 * @param {string} file - 结果里的完整路径
 * @param {string} pattern - 去掉外层引号后的查询
 * @returns {boolean} 文件名或去扩展名后的名字与查询完全一致
 */
function isExactName(file, pattern) {
  const target = String(pattern ?? '').trim().toLowerCase()
  if (target === '' || QUERY_SYNTAX.test(target)) return false
  const { base, stem } = nameParts(file)
  return stem.toLowerCase() === target || base.toLowerCase() === target
}

/** 发一次 JSON-RPC POST 并返回 `result.data.output`。 */
export async function anytxtRpc(url, method, input, { timeoutMs = RPC_TIMEOUT_MS, signal, fetchImpl = fetch } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params: { input } }),
      signal: combined,
      // 307/308 会把这个 body 重新 POST 到地址指向的任何地方，于是一个本机服务就能把请求弹到
      // 别的机器上，而它的回答还会被当成索引数据信下来。
      redirect: 'error',
    })
  } catch (error) {
    if (signal?.aborted) {
      throw new EngineError('Anytxt request was aborted', 'ANYTXT_ABORTED', { cause: error })
    }
    if (error?.name === 'TimeoutError') {
      throw new EngineError('Anytxt request timed out', 'ANYTXT_TIMEOUT', {
        cause: error,
        hint: 'Start Anytxt and retry; narrow the query if it is a large search.',
      })
    }
    throw new EngineError(unreachableMessage(error), 'ANYTXT_DOWN', {
      cause: error,
      hint: `Start the Anytxt GUI (ATGUI.exe); the index service alone does not serve ${url}.`,
    })
  }
  if (!response.ok) {
    throw new EngineError(`Anytxt returned HTTP ${response.status}`, 'ANYTXT_HTTP', {
      hint: `Check the Anytxt JSON-RPC endpoint at ${url}.`,
    })
  }
  let data
  try {
    data = await response.json()
  } catch (error) {
    if (signal?.aborted) {
      throw new EngineError('Anytxt request was aborted', 'ANYTXT_ABORTED', { cause: error })
    }
    if (error?.name === 'TimeoutError') {
      throw new EngineError('Anytxt response timed out', 'ANYTXT_TIMEOUT', { cause: error })
    }
    throw new EngineError('Anytxt returned non-JSON', 'ANYTXT_BAD_OUTPUT', { cause: error })
  }
  if (!data || typeof data !== 'object') {
    throw new EngineError('Anytxt returned a non-object JSON value', 'ANYTXT_BAD_OUTPUT')
  }
  if (data.error) {
    throw new EngineError(`Anytxt RPC error: ${JSON.stringify(data.error)}`, 'ANYTXT_RPC', {
      hint: 'Check the query syntax; Anytxt uses & | ! ( ) and "exact phrase".',
    })
  }
  const output = data.result?.data?.output
  if (output === undefined) {
    throw new EngineError('Anytxt returned no result.data.output', 'ANYTXT_RPC')
  }
  return output
}

/** 先试主地址，只在连接失败时才试 9921 回退口。 */
async function rpcFirst(urls, method, input, options) {
  let lastError
  for (const url of urls) {
    try {
      return await anytxtRpc(url, method, input, options)
    } catch (error) {
      lastError = error
      if (error.code === 'ANYTXT_DOWN' && url !== urls[urls.length - 1]) continue
      throw error
    }
  }
  throw lastError
}

/** 通过 Anytxt 检索文档内容，每个根一对请求。 */
export async function searchContent({
  query,
  roots,
  ext,
  limit = 20,
  url = DEFAULT_URL,
  timeoutMs = RPC_TIMEOUT_MS,
  signal,
  fetchImpl = fetch,
} = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new EngineError('query must be a non-empty string', 'INVALID_ARGUMENT')
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new EngineError('limit must be a positive integer', 'INVALID_ARGUMENT')
  }
  const urls = resolveAnytxtUrls(url)
  const { pattern, st } = quoteAware(query)
  const lists = []
  let total = 0

  for (const root of roots) {
    const countOut = await rpcFirst(
      urls,
      'ATRpcServer.Searcher.V1.Search',
      {
        pattern,
        filterDir: root,
        filterExt: ext || '*',
        lastModifyBegin: 0,
        lastModifyEnd: 2147483647,
        st,
      },
      { timeoutMs, signal, fetchImpl },
    )
    const count = typeof countOut.count === 'number' ? countOut.count : 0
    total += count
    if (count === 0) continue

    const page = await rpcFirst(
      urls,
      'ATRpcServer.Searcher.V1.GetResult',
      {
        pattern,
        filterDir: root,
        filterExt: ext || '*',
        lastModifyBegin: 0,
        lastModifyEnd: 2147483647,
        limit: String(limit),
        offset: 0,
        order: 0,
        st,
      },
      { timeoutMs, signal, fetchImpl },
    )
    const list = []
    for (const tuple of page.files || []) {
      const item = parseFileTuple(tuple)
      if (item) list.push(item)
    }
    lists.push(list)
  }

  // 1) 查询就是文件名时置顶：GUI 会把这个文件排第一，按根拼接的插件拿不到这个信号。
  // 2) 其余按各根内的名次轮转（C0、D0、C1、D1…），别让第一个根吃满 limit 把后面的根饿死。
  const items = []
  const seen = new Set()
  const add = (item) => {
    if (items.length >= limit || seen.has(item.ref)) return
    seen.add(item.ref)
    items.push(item)
  }
  for (const list of lists) {
    for (const item of list) {
      if (isExactName(item.path, pattern)) add(item)
    }
  }
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0)
  for (let rank = 0; rank < longest && items.length < limit; rank += 1) {
    for (const list of lists) {
      if (items.length >= limit) break
      if (list[rank]) add(list[rank])
    }
  }
  return { items, total, truncated: total > items.length }
}

/** 一个已索引文件里命中处附近的片段。 */
export async function getFragments({
  ref,
  query,
  url = DEFAULT_URL,
  timeoutMs = RPC_TIMEOUT_MS,
  signal,
  fetchImpl = fetch,
} = {}) {
  if (!ref) throw new EngineError('ref must be a non-empty string', 'INVALID_ARGUMENT')
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new EngineError('query must be a non-empty string', 'INVALID_ARGUMENT')
  }
  const output = await rpcFirst(
    resolveAnytxtUrls(url),
    'ATRpcServer.Searcher.V1.GetFragmentAll',
    { fid: ref, pattern: query },
    { timeoutMs, signal, fetchImpl },
  )
  return (output.text || []).map(stripHighlights).filter(Boolean)
}

/** 一个已索引文件的完整抽取文本。 */
export async function getRawText({
  ref,
  url = DEFAULT_URL,
  timeoutMs = RPC_TIMEOUT_MS,
  signal,
  fetchImpl = fetch,
} = {}) {
  if (!ref) throw new EngineError('ref must be a non-empty string', 'INVALID_ARGUMENT')
  const output = await rpcFirst(
    resolveAnytxtUrls(url),
    'ATRpcServer.Searcher.V1.GetRawTextByFID',
    { fid: ref },
    { timeoutMs, signal, fetchImpl },
  )
  return typeof output.text === 'string' ? output.text : ''
}

/** `fetch` 只给一句 `fetch failed`；真正的原因在 `cause` 里，取出来放进 message 便于贴 issue。 */
function causeCode(error) {
  const cause = error?.cause
  if (typeof cause?.code === 'string') return cause.code
  if (Array.isArray(cause?.errors)) {
    const first = cause.errors.find((entry) => typeof entry?.code === 'string')
    if (first !== undefined) return first.code
  }
  return ''
}

/**
 * 「连不上」的那句错误。
 *
 * 带上 TCP/DNS 层的原因码（`ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT`），否则用户贴出来的
 * 诊断只有一句无法区分的 unreachable。
 * @param {unknown} error - fetch 抛出的错误
 * @returns {string} 错误消息
 */
function unreachableMessage(error) {
  const code = causeCode(error)
  return code === '' ? 'Anytxt JSON-RPC is unreachable' : `Anytxt JSON-RPC is unreachable (${code})`
}

/**
 * 一次 Anytxt 探测落成哪一态、哪个细分类。
 *
 * `detail` 可以覆盖：「端口没人应答」只在有安装证据时才敢说「没在运行」；`extra` 带失败时
 * 探过的地址，诊断文本要用。
 * @param {string} code - 探测产生的错误码
 * @param {string} [message] - 原始错误消息
 * @param {string} [detail] - 覆盖默认的细分类
 * @returns {{state: string, detail: string, code: string, message?: string}} 四态与细分
 */
function down(code, message, detail = code === 'ANYTXT_DOWN' ? 'not-running' : 'unknown', extra = {}) {
  return { state: 'down', detail, code, message, ...extra }
}

/**
 * 探测 Anytxt 一次，永不抛异常。
 *
 * 返回**实际应答**的地址而不是第一个尝试的地址：自动配置要写回「哪个端口能用」。
 * @param {object} [args] - url / root / timeoutMs / signal / fetchImpl / installed（后两项测试注入）
 * @returns {Promise<object>} `ready` 带 `url`，其余四态带 `code` / `message`
 */
export async function probe({
  url = DEFAULT_URL,
  root = defaultProbeRoot(),
  timeoutMs = PROBE_MIN_MS,
  signal,
  fetchImpl = fetch,
  installed = anytxtInstalled,
} = {}) {
  let urls
  try {
    urls = resolveAnytxtUrls(url)
  } catch (error) {
    // 远端地址在探测里就该是「这个后端用不了」，而不是从 `probe` 里抛出去把路由打成 500。
    return down(error?.code ?? 'ANYTXT_ENDPOINT_REMOTE', error?.message, 'unknown', { url: String(url) })
  }
  let lastError
  for (const candidate of urls) {
    try {
      await anytxtRpc(
        candidate,
        'ATRpcServer.Searcher.V1.Search',
        {
          pattern: 'the',
          filterDir: root,
          filterExt: 'txt',
          lastModifyBegin: 0,
          lastModifyEnd: 2147483647,
        },
        { timeoutMs, signal, fetchImpl },
      )
      return { state: 'ready', url: candidate }
    } catch (error) {
      lastError = error
      // 与 rpcFirst 同一条规则：只有「连不上」才值得换下一个端口。
      if (error.code === 'ANYTXT_DOWN' && candidate !== urls[urls.length - 1]) continue
      break
    }
  }
  const code = lastError?.code ?? 'ANYTXT_DOWN'
  // 端口没人应答既可能是没启动、也可能是没装：只有找到 ATGUI.exe 才说「没在运行」，
  // 否则把这个判断留给用户（detail 仍是 unknown）。
  const detail = code === 'ANYTXT_DOWN' && installed() !== true ? 'unknown' : undefined
  // 把探过的地址一起交出去：贴到 issue 上时，「试的是哪个端口」是最先要排除的一项。
  return down(code, lastError?.message, detail, { url: urls[0], tried: urls })
}
