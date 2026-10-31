import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { EngineError } from './errors.js'
import { filetimeToIso } from './format.js'

const ES_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const ES_MAX_STDERR_BYTES = 64 * 1024
const EXCLUDED = [/\\\$RECYCLE\.BIN\\/i, /\\System Volume Information\\/i]

let cachedEsPath

/** 按控制台代码页解码 es.exe 的 stdout（简中下是 GBK）。 */
export function decodeEs(buffer, encoding = 'gbk') {
  try {
    return new TextDecoder(encoding).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** es.exe 的候选位置，按优先级排列。 */
export function esCandidates() {
  const localAppData = process.env.LOCALAPPDATA || ''
  return [
    'C:\\Program Files\\Everything\\es.exe',
    'C:\\Program Files (x86)\\Everything\\es.exe',
    localAppData ? `${localAppData}\\Microsoft\\WindowsApps\\es.exe` : '',
  ].filter(Boolean)
}

/** 从配置、环境变量、PATH 或常见安装目录解析出 es.exe。 */
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
    // where.exe 不可用或什么也没找到；继续往下走。
  }
  throw new EngineError('es.exe was not found', 'EVERYTHING_ES_NOT_FOUND', {
    hint: 'Install es.exe (https://www.voidtools.com/downloads/), add it to PATH, or set esPath in the plugin config.',
  })
}

/** 拼出固定、只读的 es.exe argv。模型给的文本永远放在 `--` 之后。 */
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

/** 带缓冲上限、超时与取消地跑 es.exe。 */
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
        // 进程已经没了。
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
      const output = decodeEs(Buffer.concat(stdout), encoding).trim()
      if (isFailedExit(code, output)) {
        const detail = decodeEs(Buffer.concat(stderr), encoding).trim()
        return finish(
          new EngineError(`es.exe exited ${code}${detail ? `: ${detail}` : ''}`, 'EVERYTHING_DOWN', {
            hint: 'Start the Everything executable, then retry.',
          }),
        )
      }
      finish(undefined, output)
    })
  })
}

/**
 * es.exe 这次退出是「没有答案」还是「没有命中」。
 *
 * es.exe 对「什么也没匹配到」和「连接失败」都用 exit 1，光看 code 判不出来；stdout 为空而
 * stderr 有内容才是失败，其余都算有结果。
 * @param {number} code - 进程的退出码
 * @param {string} output - 去掉首尾空白的 stdout
 * @returns 这次调用没有拿到可用答案时为 true
 */
export function isFailedExit(code, output) {
  return code !== 0 && (code !== 1 || output === '')
}

/** 把 es.exe 的 `-json` 输出解析成行，这一步在任何排除过滤之前。 */
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
    .filter((row) => row && typeof row.filename === 'string')
    .map((row) => {
      const item = { path: row.filename }
      if (typeof row.size === 'number') item.size = row.size
      const modified = filetimeToIso(row.date_modified)
      if (modified) item.modified = modified
      return item
    })
}

/**
 * 丢掉落在我们从不暴露的索引里的行。
 * @param {Array<{path: string}>} rows - 已解析的行
 * @returns {Array<{path: string}>} 工具可以返回的行
 */
export function withoutExcludedPaths(rows) {
  return rows.filter((row) => !EXCLUDED.some((re) => re.test(row.path)))
}

/** Everything.exe 的候选位置，按优先级排列。 */
export function everythingCandidates() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return [`${programFiles}\\Everything\\Everything.exe`, `${programFilesX86}\\Everything\\Everything.exe`]
}

/**
 * Everything 本身装了没有，与 es.exe 无关。
 *
 * 服务不存在时 `sc query` 退出码非零，这是本地化的 Windows 控制台下唯一还立得住的信号。装在
 * Program Files 之外（或便携版）只能靠那个服务找到，所以一个根本没能跑起来的检查报
 * `known: false`，而不是断言「没装」。
 * @returns {{installed: boolean, via?: 'exe'|'service', known: boolean}} 安装证据
 */
export function everythingInstalled() {
  for (const candidate of everythingCandidates()) {
    if (existsSync(candidate)) return { installed: true, via: 'exe', known: true }
  }
  try {
    execFileSync('sc.exe', ['query', 'Everything'], { encoding: 'utf8', windowsHide: true, timeout: 2000 })
    return { installed: true, via: 'service', known: true }
  } catch (error) {
    // `status` 是数字说明 sc.exe 跑起来了、服务确实不在；spawn 失败（EPERM、ENOENT）说明不了
    // 这台机器的任何事。
    const ran = typeof error?.status === 'number'
    return { installed: false, known: ran }
  }
}

/** 通过 Everything 检索文件名/路径。 */
export async function searchFiles({ query, dir, limit = 20, esPath, timeoutMs, signal, encoding } = {}) {
  const executable = esPath || resolveEsPath({})
  const args = buildEsArgs({ query, dir, limit })
  const text = await runEsText(args, { esPath: executable, timeoutMs, signal, encoding })
  const rows = parseEsJson(text)
  // 截断按 es.exe 返回了什么来判，而不是按排除 $RECYCLE.BIN 之后剩下什么：一整页都被排除的
  // 命中不能读成一句平平的 "no files found"。
  return { items: withoutExcludedPaths(rows), truncated: rows.length >= limit }
}

/** 读正在运行的 Everything 版本。 */
export async function getEsVersion({ esPath, timeoutMs, signal, encoding } = {}) {
  const executable = esPath || resolveEsPath({})
  const text = await runEsText(['-get-everything-version'], { esPath: executable, timeoutMs, signal, encoding })
  if (!text) throw new EngineError('Everything version probe returned nothing', 'EVERYTHING_DOWN')
  return text
}
