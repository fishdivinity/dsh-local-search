/**
 * 五个工具共享的那一层：错误包装、参数收窄、卡片元数据、工作区解析。
 *
 * 拆出来是为了让每个工具文件只读自己那 80–110 行；共享层不认识任何具体工具，也不碰注册表。
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { readConfig } from '../config.js'
import { MAX_LIMIT } from '../limits.js'
import { detect } from '../platform.js'

/** 平台事实一次算定：它在一个进程里不会变；`all` 的根列表例外，每次现算。 */
export const PLATFORM = detect()

/**
 * 注册时固定的配置快照：工具的 schema 与默认文案从它取，调用时只读 volatile 引用。
 * @typedef {ReturnType<typeof readConfig>} ConfigSnapshot
 */

/**
 * 五个工具工厂的入参：运行时上下文 + 注册时固定的快照。
 * @typedef {object} ToolDeps
 * @property {ToolContext} ctx - 运行时上下文（`workingDirectory` 由宿主注入）
 * @property {object} config - schema 输出，含 volatile 引用
 * @property {ConfigSnapshot} initial - 注册时固定的默认值与上限
 * @property {{files: string[], content: string[]}} names - 注册表里的后端名
 */

/**
 * 工具的运行时上下文：`workingDirectory` 由宿主注入（入口的 `inject` 里有它）。
 * @typedef {import('@deepseek-ai/cordis').Context & {
 *   workingDirectory?: import('@deepseek-ai/dsh-working-directory').WorkingDirectoryService,
 * }} ToolContext
 */

/**
 * 本地错误按 Node 的写法带 `code`，HarnessError 用它做错误码；不带就是通用的本地检索错。
 * @param {Error & {code?: string}} error - 抛出来的东西
 * @returns {HarnessError} 能交给工具运行时的错误
 */
export function toHarnessError(error) {
  if (error instanceof HarnessError) return error
  if (error instanceof Error) {
    return new HarnessError(error.message, error.code || 'LOCAL_SEARCH_ERROR', { cause: error })
  }
  return new HarnessError(String(error), 'LOCAL_SEARCH_ERROR')
}

/**
 * 把一次调用包成「任何抛出都变成 HarnessError」。
 * @param {() => Promise<object>} fn - 工具的执行体
 * @returns {Promise<object>} 执行结果
 */
export async function guard(fn) {
  try {
    return await fn()
  } catch (error) {
    throw toHarnessError(error)
  }
}

/**
 * 把可选的数字参数收进 `[1, cap]`。非数字参数回落到配置的默认值，而不是让窗口变成 NaN
 * ——那样会静默返回空结果。
 * @param value - 模型发来的参数原样
 * @param fallback - 不是有限数字时用的默认值
 * @param cap - 闭区间上界
 * @returns 可用的条数
 */
export function clampCount(value, fallback, cap) {
  const number = Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, Math.min(cap, number))
}

/** 条数上限：与配置的默认值一起决定窗口。 */
export function clampLimit(value, fallback) {
  return clampCount(value, fallback, MAX_LIMIT)
}

/** 字符偏移：负数与非数字都当 0。 */
export function clampOffset(value) {
  return Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0)
}

/** 空查询在任何后端都只会白跑一次，所以在工具入口就拒掉。 */
export function requireQuery(query) {
  const value = typeof query === 'string' ? query.trim() : ''
  if (value.length === 0) throw new Error('query must be a non-empty string')
  return value
}

/** `engine` 只能是 `auto` 或注册表里有的名字。 */
export function validateEngine(engine, allowed) {
  const value = engine || 'auto'
  if (!allowed.includes(value)) {
    throw new Error(`engine must be one of ${allowed.join(', ')}`)
  }
  return value
}

/**
 * 这次调用该用哪个后端。
 *
 * `auto`（或没传）跟随配置里选的后端，而不是「注册表里的第一个」：配置里的 backend 就是
 * 「默认用哪个」的声明，自动选第一个会让那个字段变成死配置。
 * @param {string|undefined} requested - 调用参数里的 engine
 * @param {string} configured - 配置里选的后端
 * @returns {string} 要解析的后端名
 */
export function engineFor(requested, configured) {
  return requested === undefined || requested === '' || requested === 'auto' ? configured : requested
}

/**
 * 搜索卡片的标题。
 * @param {string} label - 卡片标题的前半句
 * @returns {(args: {query?: string}) => import('@deepseek-ai/dsh-tools').ToolCallView} 生成卡片回调
 */
export function presentSearchCall(label) {
  return (args) => ({
    card: 'generic',
    title: `${label}${args?.query ? `: ${args.query}` : ''}`,
    kind: 'search',
    rawInput: args?.query,
  })
}

/**
 * 返回值必须在这里收窄成卡片：`card` / `shape` 是字面量，推断时会宽成 string。
 * @returns {import('@deepseek-ai/dsh-tools').ToolResultView|undefined} 搜索卡片，或读不到元数据时 undefined
 */
export function presentSearchResult(_args, result) {
  if (result.isError) return undefined
  const meta = result.meta
  if (!meta || !Array.isArray(meta.paths)) return undefined
  return {
    card: 'search',
    shape: 'paths',
    paths: meta.paths,
    truncated: Boolean(meta.truncated),
    total: typeof meta.total === 'number' ? meta.total : meta.paths.length,
  }
}

/**
 * 解析这次调用该搜哪里：显式配置优先，其次会话工作目录。
 * @param {ToolContext} ctx - 工具的运行时上下文
 * @param {{agent?: object, signal?: AbortSignal}} exec - 宿主给的执行上下文
 * @param {object} cfg - 配置快照
 * @returns {Promise<string>} 工作区目录
 */
export async function resolveWorkspace(ctx, exec, cfg) {
  if (cfg.scopes.workspaceRoot) return cfg.scopes.workspaceRoot
  if (exec.agent && ctx.workingDirectory?.ensure) {
    try {
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    } catch (error) {
      /** @type {Error & {code?: string}} */
      const wrapped = new Error(`cannot resolve the session working directory: ${error.message}`)
      wrapped.code = 'WORKSPACE_UNAVAILABLE'
      wrapped.cause = error
      throw wrapped
    }
  }
  return ctx.workingDirectory?.defaultDirectory || process.cwd()
}
