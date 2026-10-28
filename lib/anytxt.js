import { EngineError } from './errors.js'

const DEFAULT_URL = 'http://127.0.0.1:9920'
const EXCLUDED = [/\\\$RECYCLE\.BIN\\/i, /\\System Volume Information\\/i]
const RPC_TIMEOUT_MS = 15000

/** Primary URL plus the 9921 fallback used by some Anytxt builds. */
export function resolveAnytxtUrls(url = DEFAULT_URL) {
  const base = String(url || DEFAULT_URL).replace(/\/+$/, '')
  const urls = [base]
  if (/:9920$/.test(base)) urls.push(base.replace(/:9920$/, ':9921'))
  return urls
}

/** Quoted phrases use exact mode (st=1); other queries use advanced mode. */
export function quoteAware(query) {
  const trimmed = String(query ?? '').trim()
  if (/^".*"$/s.test(trimmed)) {
    return { pattern: trimmed.slice(1, -1), st: '1' }
  }
  return { pattern: trimmed, st: '2' }
}

/** Remove Anytxt's match highlight markers from snippets. */
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

/** POST one JSON-RPC request and return `result.data.output`. */
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

/** Try the primary URL, then the 9921 fallback only on connection failures. */
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

/** Search document contents through Anytxt, one request pair per root. */
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

/** Snippets around a match in one indexed file. */
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

/** Full extracted text for one indexed file. */
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

/** Probe Anytxt without throwing. */
export async function anytxtStatus({
  url = DEFAULT_URL,
  root = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\',
  timeoutMs = 1500,
  signal,
  fetchImpl = fetch,
} = {}) {
  const urls = resolveAnytxtUrls(url)
  try {
    await rpcFirst(
      urls,
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
    return { ok: true, url: urls[0] }
  } catch (error) {
    return { ok: false, code: error.code ?? 'ANYTXT_DOWN', message: error.message, url: urls[0] }
  }
}
