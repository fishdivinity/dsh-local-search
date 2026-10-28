import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { EngineError } from './errors.js'
import { filetimeToIso } from './format.js'

const ES_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const ES_MAX_STDERR_BYTES = 64 * 1024
const EXCLUDED = [/\\\$RECYCLE\.BIN\\/i, /\\System Volume Information\\/i]

let cachedEsPath

/** Decode es.exe stdout using the console code page (GBK on zh-CN). */
export function decodeEs(buffer, encoding = 'gbk') {
  try {
    return new TextDecoder(encoding).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** Candidate es.exe locations, in priority order. */
export function esCandidates() {
  const localAppData = process.env.LOCALAPPDATA || ''
  return [
    'C:\\Program Files\\Everything\\es.exe',
    'C:\\Program Files (x86)\\Everything\\es.exe',
    localAppData ? `${localAppData}\\Microsoft\\WindowsApps\\es.exe` : '',
  ].filter(Boolean)
}

/** Resolve es.exe from config, env, PATH, or common install directories. */
export function resolveEsPath(config = {}) {
  if (config.esPath) {
    if (!existsSync(config.esPath)) {
      throw new EngineError(`es.exe not found at the configured esPath: ${config.esPath}`, 'EVERYTHING_ES_NOT_FOUND', {
        hint: 'Point esPath at the es.exe download from https://www.voidtools.com/downloads/',
      })
    }
    return config.esPath
  }
  if (process.env.ES_PATH && existsSync(process.env.ES_PATH)) return process.env.ES_PATH
  if (cachedEsPath && existsSync(cachedEsPath)) return cachedEsPath
  for (const candidate of esCandidates()) {
    if (existsSync(candidate)) {
      cachedEsPath = candidate
      return candidate
    }
  }
  try {
    const output = execFileSync('where.exe', ['es.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    })
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (first && existsSync(first)) {
      cachedEsPath = first
      return first
    }
  } catch {
    // where.exe is unavailable or found nothing; fall through.
  }
  throw new EngineError('es.exe was not found', 'EVERYTHING_ES_NOT_FOUND', {
    hint: 'Install es.exe (https://www.voidtools.com/downloads/), add it to PATH, or set esPath in the plugin config.',
  })
}

/** Build the fixed, read-only es.exe argv. Model text is always after `--`. */
export function buildEsArgs({ query, limit = 20, dir } = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new EngineError('query must be a non-empty string', 'INVALID_ARGUMENT')
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new EngineError('limit must be a positive integer', 'INVALID_ARGUMENT')
  }
  const args = ['-n', String(limit), '-json', '-size', '-date-modified']
  if (dir) {
    if (!isAbsolute(dir) || !existsSync(dir)) {
      throw new EngineError(`dir is not an existing absolute directory: ${dir}`, 'ROOT_NOT_FOUND')
    }
    args.push('-path', dir)
  }
  args.push('--', query)
  return args
}

/** Run es.exe with a bounded buffer, timeout, and cancellation. */
export function runEsText(args, { esPath, timeoutMs = 15000, signal, encoding = 'gbk' } = {}) {
  return new Promise((resolve, reject) => {
    const executable = esPath || resolveEsPath({})
    let settled = false
    let timer
    let child

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    const finish = (error, text) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(text)
    }
    const stop = (error) => {
      try {
        child?.kill()
      } catch {
        // Process already gone.
      }
      finish(error)
    }
    const onAbort = () =>
      stop(new EngineError('Everything search was aborted', 'EVERYTHING_ABORTED'))

    if (signal?.aborted) {
      onAbort()
      return
    }

    try {
      child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish(
        new EngineError(`cannot start es.exe: ${error.message}`, 'EVERYTHING_DOWN', {
          cause: error,
          hint: 'Check that Everything/es.exe is installed and that esPath is correct.',
        }),
      )
      return
    }

    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0

    timer = setTimeout(() => {
      stop(new EngineError('Everything search timed out', 'EVERYTHING_TIMEOUT', { hint: 'Narrow the query or raise timeoutMs.' }))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > ES_MAX_OUTPUT_BYTES) {
        stop(new EngineError('Everything output exceeded 8 MB', 'EVERYTHING_TOO_LARGE', { hint: 'Narrow the query.' }))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (stderrBytes >= ES_MAX_STDERR_BYTES) return
      stderrBytes += chunk.length
      stderr.push(chunk)
    })
    child.on('error', (error) => {
      const code = error.code === 'ENOENT' ? 'EVERYTHING_ES_NOT_FOUND' : 'EVERYTHING_DOWN'
      stop(
        new EngineError(`cannot start es.exe: ${error.message}`, code, {
          cause: error,
          hint: 'Start the Everything executable and verify esPath.',
        }),
      )
    })
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        const detail = decodeEs(Buffer.concat(stderr), encoding).trim()
        return finish(
          new EngineError(`es.exe exited ${code}${detail ? `: ${detail}` : ''}`, 'EVERYTHING_DOWN', {
            hint: 'Start the Everything executable, then retry.',
          }),
        )
      }
      finish(undefined, decodeEs(Buffer.concat(stdout), encoding).trim())
    })
  })
}

/** Parse es.exe `-json` output into bounded, filtered rows. */
export function parseEsJson(text) {
  if (!text || text.trim().length === 0) return []
  let rows
  try {
    rows = JSON.parse(text)
  } catch (error) {
    throw new EngineError('es.exe returned unparsable JSON', 'EVERYTHING_BAD_OUTPUT', { cause: error })
  }
  if (!Array.isArray(rows)) {
    throw new EngineError('es.exe JSON output was not an array', 'EVERYTHING_BAD_OUTPUT')
  }
  return rows
    .filter((row) => row && typeof row.filename === 'string' && !EXCLUDED.some((re) => re.test(row.filename)))
    .map((row) => {
      const item = { path: row.filename }
      if (typeof row.size === 'number') item.size = row.size
      const modified = filetimeToIso(row.date_modified)
      if (modified) item.modified = modified
      return item
    })
}

/** Search file names/paths through Everything. */
export async function searchFiles({ query, dir, limit = 20, esPath, timeoutMs, signal, encoding } = {}) {
  const executable = esPath || resolveEsPath({})
  const args = buildEsArgs({ query, dir, limit })
  const text = await runEsText(args, { esPath: executable, timeoutMs, signal, encoding })
  const items = parseEsJson(text)
  return { items, truncated: items.length >= limit }
}

/** Read the running Everything version. */
export async function getEsVersion({ esPath, timeoutMs, signal, encoding } = {}) {
  const executable = esPath || resolveEsPath({})
  const text = await runEsText(['-get-everything-version'], { esPath: executable, timeoutMs, signal, encoding })
  if (!text) throw new EngineError('Everything version probe returned nothing', 'EVERYTHING_DOWN')
  return text
}
