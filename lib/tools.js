import { defineTool } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { EngineError } from './errors.js'
import { engineNames, resolveContentEngine, resolveFilesEngine } from './engines.js'
import { formatContent, formatFiles, formatFragments, formatRead, formatStatus } from './format.js'
import { parseRef, assertRefEngine } from './ref.js'
import { defaultAllRoots, parseAllRoots, rootsFor } from './roots.js'
import { readConfig } from './config.js'
import { probeEngines } from './probe.js'
import { MAX_LIMIT, MAX_READ } from './limits.js'

const STATUS_ENGINES = ['auto', ...new Set([...engineNames().files, ...engineNames().content])]
const MAX_FRAGMENTS = 20

function toHarnessError(error) {
  if (error instanceof HarnessError) return error
  if (error instanceof Error) {
    return new HarnessError(error.message, error.code || 'LOCAL_SEARCH_ERROR', { cause: error })
  }
  return new HarnessError(String(error), 'LOCAL_SEARCH_ERROR')
}

async function guard(fn) {
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
function clampCount(value, fallback, cap) {
  const number = Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, Math.min(cap, number))
}

function clampLimit(value, fallback) {
  return clampCount(value, fallback, MAX_LIMIT)
}

function clampOffset(value) {
  return Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0)
}

function requireQuery(query) {
  const value = typeof query === 'string' ? query.trim() : ''
  if (value.length === 0) throw new Error('query must be a non-empty string')
  return value
}

function validateEngine(engine, allowed) {
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
function engineFor(requested, configured) {
  return requested === undefined || requested === '' || requested === 'auto' ? configured : requested
}

function presentSearchCall(label) {
  return (args) => ({
    card: 'generic',
    title: `${label}${args?.query ? `: ${args.query}` : ''}`,
    kind: 'search',
    rawInput: args?.query,
  })
}

function presentSearchResult(_args, result) {
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

const filesOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            size: { type: 'number' },
            modified: { type: 'string' },
          },
        },
      },
      truncated: { type: 'boolean', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: formatFiles(value) }],
  presentationMeta: (_args, value) => ({
    paths: value.items.map((item) => item.path),
    truncated: value.truncated,
    total: value.items.length,
  }),
}

const contentOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ref: { type: 'string', required: true },
            engine: { type: 'string', required: true },
            path: { type: 'string', required: true },
            size: { type: 'number' },
            modified: { type: 'string' },
          },
        },
      },
      total: { type: 'number', required: true },
      truncated: { type: 'boolean', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: formatContent(value) }],
  presentationMeta: (_args, value) => ({
    paths: value.items.map((item) => item.path),
    truncated: value.truncated,
    total: value.total,
  }),
}

const fragmentsOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      fragments: {
        type: 'array',
        required: true,
        items: { type: 'string' },
      },
    },
  },
  render: (_args, value) => [{ type: 'text', text: formatFragments(value) }],
}

const readOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
      totalChars: { type: 'number', required: true },
      offset: { type: 'number', required: true },
      returned: { type: 'number', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: formatRead(value) }],
}

const statusOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

/**
 * 构建并注册五个面向模型的工具。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 * @returns {Array<() => void>} 工具的 disposer
 */
export function createTools(ctx, config) {
  // 注册时就固定了工具的截止时间与描述默认值的文案；一次调用真正用到的一切都是每次操作现读
  // 的，所以配置页上的保存对下一次调用生效，而不是对下一次重载生效。
  const initial = readConfig(config)
  const names = engineNames()

  async function resolveWorkspace(exec, cfg) {
    if (cfg.scopes.workspaceRoot) return cfg.scopes.workspaceRoot
    if (exec.agent && ctx.workingDirectory?.ensure) {
      try {
        return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      } catch (error) {
        const wrapped = new Error(`cannot resolve the session working directory: ${error.message}`)
        wrapped.code = 'WORKSPACE_UNAVAILABLE'
        wrapped.cause = error
        throw wrapped
      }
    }
    return ctx.workingDirectory?.defaultDirectory || process.cwd()
  }

  const filesTool = defineTool({
    name: 'local_search_files',
    description:
      'Use this when the user asks for files or folders by name/path, especially outside the current workspace or across drives. ' +
      'It queries the Everything index (NTFS metadata only: names, paths, size, dates; it does NOT search file contents). ' +
      'Do not use it for text inside PDF/Office documents (use local_search_content) or for source-code content search (use grep). ' +
      'Default scope is the workspace; set scope="all" only when the user explicitly asks for a cross-drive/global search.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Everything search text: wildcards, ext:, size:, dm:, path:, | and ! operators.',
      },
      scope: {
        type: 'string',
        description: 'workspace (default), work, personal, or all.',
      },
      path: {
        type: 'string',
        description: 'Optional absolute directory; overrides scope.',
      },
      engine: {
        type: 'string',
        description: `auto (default) follows the configured files backend; ${names.files.join(', ')} otherwise. Name one only when the user asks for a specific engine.`,
      },
      limit: {
        type: 'number',
        description: `Max results (default ${initial.limits.maxResults}; max ${MAX_LIMIT}).`,
      },
    },
    timeoutMs: initial.timeoutMs,
    output: filesOutput,
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        const query = requireQuery(args.query)
        const engine = resolveFilesEngine(engineFor(args.engine, cfg.files.backend))
        const scope = args.scope || 'workspace'
        const workspace = await resolveWorkspace(exec, cfg)
        let dir
        if (scope === 'all' && !args.path) {
          dir = undefined
        } else {
          dir = rootsFor(scope, args.path, cfg, workspace)[0]
        }
        return await engine.search({
          query,
          dir,
          limit: clampLimit(args.limit, cfg.limits.maxResults),
          esPath: cfg.files.everything.esPath,
          timeoutMs: initial.timeoutMs,
          signal: exec.signal,
          encoding: cfg.files.everything.esEncoding,
        })
      })
    },
    presentCall: presentSearchCall('Everything search'),
    presentResult: presentSearchResult,
  })

  const contentTool = defineTool({
    name: 'local_search_content',
    description:
      'Use this when the user asks for text inside PDF, DOCX, XLSX, PPTX, EPUB, RTF, TXT or MD documents, or for a whole-disk content search. ' +
      'It queries the Anytxt index and returns refs for local_search_fragments/local_search_read. ' +
      'Do not use it for source-code search in the workspace (use grep; the index can be stale). ' +
      'Default scope is the workspace; set scope="all" only when the user explicitly asks for a cross-drive/global search.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keywords; supports & | ! ( ) and "exact phrase".',
      },
      scope: {
        type: 'string',
        description: 'workspace (default), work, personal, or all.',
      },
      path: {
        type: 'string',
        description: 'Optional absolute directory; overrides scope.',
      },
      ext: {
        type: 'string',
        description: 'Optional extension filter, e.g. "pdf;docx".',
      },
      engine: {
        type: 'string',
        description: `auto (default) follows the configured content backend; ${names.content.join(', ')} otherwise. Name one only when the user asks for a specific engine.`,
      },
      limit: {
        type: 'number',
        description: `Max files (default ${initial.limits.maxResults}; max ${MAX_LIMIT}).`,
      },
    },
    timeoutMs: initial.timeoutMs,
    output: contentOutput,
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        const query = requireQuery(args.query)
        const engine = resolveContentEngine(engineFor(args.engine, cfg.content.backend))
        const workspace = await resolveWorkspace(exec, cfg)
        const roots = rootsFor(args.scope || 'workspace', args.path, cfg, workspace)
        const result = await engine.search({
          query,
          roots,
          ext: args.ext,
          limit: clampLimit(args.limit, cfg.limits.maxResults),
          url: cfg.content.anytxt.url,
          timeoutMs: initial.timeoutMs,
          signal: exec.signal,
        })
        return result
      })
    },
    presentCall: presentSearchCall('Anytxt content search'),
    presentResult: presentSearchResult,
  })

  const fragmentsTool = defineTool({
    name: 'local_search_fragments',
    description:
      'Use this after local_search_content to get the text around a match inside one indexed file. ' +
      'Returns a few snippets, not the whole document; use local_search_read for the full extracted text.',
    parameters: {
      ref: {
        type: 'string',
        required: true,
        description: 'Reference returned by local_search_content.',
      },
      engine: {
        type: 'string',
        description: 'auto (default) or a content engine name; refs are self-describing, so usually omit.',
      },
      query: {
        type: 'string',
        required: true,
        description: 'Keyword whose surrounding text should be returned.',
      },
      max: {
        type: 'number',
        description: `Max snippets (default 8; max ${MAX_FRAGMENTS}).`,
      },
    },
    timeoutMs: initial.timeoutMs,
    output: fragmentsOutput,
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        if (typeof args.ref !== 'string' || args.ref.trim().length === 0) {
          throw new Error('ref must be a non-empty string')
        }
        const query = requireQuery(args.query)
        const parsed = parseRef(args.ref)
        const requested = args.engine && args.engine !== 'auto' ? args.engine : parsed.engine
        const engine = resolveContentEngine(requested)
        assertRefEngine(parsed, engine.name)
        if (typeof engine.fragments !== 'function') {
          throw new EngineError(`content engine "${engine.name}" does not support fragments`, 'ENGINE_READ_UNSUPPORTED', {
            hint: 'Use local_search_content or a different content engine.',
          })
        }
        const max = clampCount(args.max, 8, MAX_FRAGMENTS)
        const fragments = await engine.fragments({
          ref: args.ref,
          query,
          url: cfg.content.anytxt.url,
          timeoutMs: initial.timeoutMs,
          signal: exec.signal,
        })
        return { fragments: fragments.slice(0, max) }
      })
    },
  })

  const readTool = defineTool({
    name: 'local_search_read',
    description:
      'Use this to read the extracted plain text of one indexed document by ref. The result is capped; ' +
      'for normal text files in the workspace use read instead of this tool.',
    parameters: {
      ref: {
        type: 'string',
        required: true,
        description: 'Reference returned by local_search_content.',
      },
      engine: {
        type: 'string',
        description: 'auto (default) or a content engine name; refs are self-describing, so usually omit.',
      },
      offset: {
        type: 'number',
        description: 'Character offset (default 0).',
      },
      max: {
        type: 'number',
        description: `Max characters (default ${initial.limits.readMaxChars}; max ${MAX_READ}).`,
      },
    },
    timeoutMs: initial.timeoutMs,
    output: readOutput,
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        if (typeof args.ref !== 'string' || args.ref.trim().length === 0) {
          throw new Error('ref must be a non-empty string')
        }
        const max = clampCount(args.max, cfg.limits.readMaxChars, MAX_READ)
        const offset = clampOffset(args.offset)
        const parsed = parseRef(args.ref)
        const requested = args.engine && args.engine !== 'auto' ? args.engine : parsed.engine
        const engine = resolveContentEngine(requested)
        assertRefEngine(parsed, engine.name)
        if (typeof engine.read !== 'function') {
          throw new EngineError(`content engine "${engine.name}" does not support read`, 'ENGINE_READ_UNSUPPORTED', {
            hint: 'Use local_search_content or a different content engine.',
          })
        }
        const text = await engine.read({
          ref: args.ref,
          url: cfg.content.anytxt.url,
          timeoutMs: initial.timeoutMs,
          signal: exec.signal,
        })
        const slice = text.slice(offset, offset + max)
        return { text: slice, totalChars: text.length, offset, returned: slice.length }
      })
    },
  })

  const statusTool = defineTool({
    name: 'local_search_status',
    description:
      'Use this when a search reports EVERYTHING_DOWN or ANYTXT_DOWN, or before a large batch, to check whether the Everything index and the Anytxt JSON-RPC service are reachable. ' +
      'Returns both statuses plus the configured search roots.',
    parameters: {
      engine: {
        type: 'string',
        description: `auto (default), ${[...names.files, ...names.content].join(', ')}. Limit the probe to one engine.`,
      },
    },
    timeoutMs: initial.timeoutMs,
    output: statusOutput,
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        const engine = validateEngine(args.engine, STATUS_ENGINES)
        let workspace = cfg.scopes.workspaceRoot || ctx.workingDirectory?.defaultDirectory || process.cwd()
        try {
          workspace = await resolveWorkspace(exec, cfg)
        } catch {
          // 工作区没了也得把引擎报出来。
        }

        // 与配置页测试按钮要的是同一个探测。
        const { everything, anytxt } = await probeEngines(config, {
          only: engine,
          workspace,
          signal: exec.signal,
        })

        const all = cfg.scopes.allRoots ? parseAllRoots(cfg.scopes.allRoots) : defaultAllRoots()
        return {
          text: formatStatus({
            everything,
            anytxt,
            engines: engineNames(),
            roots: {
              workspace,
              work: cfg.scopes.workRoot,
              personal: cfg.scopes.personalRoot,
              all,
            },
          }),
        }
      })
    },
  })

  return [filesTool, contentTool, fragmentsTool, readTool, statusTool]
}
