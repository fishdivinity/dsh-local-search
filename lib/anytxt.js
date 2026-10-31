import { EngineError } from './errors.js'
import { isLoopbackUrl } from './config.js'

const DEFAULT_URL = 'http://127.0.0.1:9920'
const EXCLUDED = [/\\\$RECYCLE\.BIN\\/i, /\\System Volume Information\\/i]
const RPC_TIMEOUT_MS = 15000

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
  if (/:9920$/.test(base)) urls.push(base.replace(/:9920$/, ':9921'))
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
    throw new EngineError('Anytxt JSON-RPC is unreachable', 'ANYTXT_DOWN', {
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
  const byRef = new Map()
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
    for (const tuple of page.files || []) {
      const item = parseFileTuple(tuple)
      if (item && !byRef.has(item.ref)) byRef.set(item.ref, item)
    }
  }

  const items = [...byRef.values()].slice(0, limit)
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

/**
 * 探测 Anytxt，不抛异常。
 *
 * 返回**实际应答**的那个地址，不是第一个尝试的地址：`resolveAnytxtUrls` 会带上 `:9921` 回退，
 * 而自动配置要把「哪个端口能用」写回配置，报错端口等于把结论写反。
 */
export async function anytxtStatus({
  url = DEFAULT_URL,
  root = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\',
  timeoutMs = 1500,
  signal,
  fetchImpl = fetch,
} = {}) {
  const urls = resolveAnytxtUrls(url)
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
      return { ok: true, url: candidate }
    } catch (error) {
      lastError = error
      // 与 rpcFirst 同一条规则：只有「连不上」才值得换下一个端口。
      if (error.code === 'ANYTXT_DOWN' && candidate !== urls[urls.length - 1]) continue
      break
    }
  }
  return {
    ok: false,
    code: lastError?.code ?? 'ANYTXT_DOWN',
    message: lastError?.message,
    url: urls[0],
  }
}
