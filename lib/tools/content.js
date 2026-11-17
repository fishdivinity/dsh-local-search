import { defineTool } from '@deepseek-ai/dsh-tools'
import { readConfig } from '../config.js'
import { resolveContentEngine } from '../engines.js'
import { formatContent } from '../format.js'
import { MAX_LIMIT } from '../limits.js'
import { detect } from '../platform.js'
import { allRootsFor, parseAllRoots, rootsFor } from '../roots.js'
import {
  PLATFORM,
  clampLimit,
  engineFor,
  guard,
  presentSearchCall,
  presentSearchResult,
  requireQuery,
  resolveWorkspace,
} from './shared.js'

/**
 * 内容检索（Anytxt）：返回 ref，后续片段与全文读取靠它。
 * @param {import('./shared.js').ToolDeps} deps - 运行时上下文与注册时固定的快照
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 内容工具
 */
export function createContentTool({ ctx, config, initial, names }) {
  return defineTool({
    name: 'local_search_content',
    description:
      'Use this when the user asks for text inside PDF, DOCX, XLSX, PPTX, EPUB, RTF, TXT or MD documents, or for a whole-disk content search. ' +
      'It queries the Anytxt index and returns refs for local_search_fragments/local_search_read. ' +
      'Do not use it for source-code search in the workspace (use grep; the index can be stale). ' +
      'Default scope is configured (all available roots unless changed); pass scope or path to narrow.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keywords; use | for OR, & for AND, ! to exclude; "exact phrase". OR/AND are literal text.',
      },
      scope: {
        type: 'string',
        description: 'all, workspace, work, personal; omit to use scopes.defaultScope.',
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
    output: {
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
          // 退回 workspace / 跳过失配根时 execute 会拼上这两个键；不声明它们，执行器会在 render 之前拒收。
          scopeFallback: { type: 'boolean' },
          scopeMissing: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatContent(value) }],
      presentationMeta: (_args, value) => ({
        paths: value.items.map((item) => item.path),
        truncated: value.truncated,
        total: value.total,
      }),
    },
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        const query = requireQuery(args.query)
        const engine = resolveContentEngine(engineFor(args.engine, cfg.content.backend))
        const workspace = await resolveWorkspace(ctx, exec, cfg)
        const scope = args.scope || cfg.scopes.defaultScope
        // 根会变：`all` 且没配 allRoots 时每次现算；显式 path 与其它范围都不需要扫盘。
        const configuredAll = parseAllRoots(cfg.scopes.allRoots).length > 0
        const platform = scope === 'all' && !args.path && !configuredAll ? detect() : PLATFORM
        let roots
        let scopeFallback = false
        let scopeMissing = []
        if (scope === 'all' && !args.path) {
          // 配置的根全不在时退回 workspace，并把这件事写进结果：整机检索变成单目录检索要能被看见。
          const resolved = allRootsFor(cfg, workspace, platform)
          roots = resolved.roots
          scopeFallback = resolved.fellBack
          // 只有一部分根不在时结果会静默变少，同样要在结果里说一句。
          scopeMissing = resolved.fellBack ? [] : resolved.missing
        } else {
          roots = rootsFor(scope, args.path, cfg, workspace, platform)
        }
        const result = await engine.search({
          query,
          roots,
          ext: args.ext,
          limit: clampLimit(args.limit, cfg.limits.maxResults),
          url: cfg.content.anytxt.url,
          timeoutMs: initial.timeoutMs,
          signal: exec.signal,
        })
        return scopeFallback || scopeMissing.length > 0 ? { ...result, scopeFallback, scopeMissing } : result
      })
    },
    presentCall: presentSearchCall('Anytxt content search'),
    presentResult: presentSearchResult,
  })
}
