import { defineTool } from '@deepseek-ai/dsh-tools'
import { readConfig } from '../config.js'
import { resolveFilesEngine } from '../engines.js'
import { formatFiles } from '../format.js'
import { MAX_LIMIT } from '../limits.js'
import { rootsFor } from '../roots.js'
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
 * 文件名检索（Everything）。
 * @param {import('./shared.js').ToolDeps} deps - 运行时上下文与注册时固定的快照
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 文件名工具
 */
export function createFilesTool({ ctx, config, initial, names }) {
  return defineTool({
    name: 'local_search_files',
    description:
      'Use this when the user asks for files or folders by name/path, especially outside the current workspace or across drives. ' +
      'It queries the Everything index (NTFS metadata only: names, paths, size, dates; it does NOT search file contents). ' +
      'Do not use it for text inside PDF/Office documents (use local_search_content) or for source-code content search (use grep). ' +
      'Default scope is configured (all available roots unless changed); pass scope or path to narrow.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Everything search text: wildcards, ext:, size:, dm:, path:, | and ! operators.',
      },
      scope: {
        type: 'string',
        description: 'all, workspace, work, personal; omit to use scopes.defaultScope.',
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
    },
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        const query = requireQuery(args.query)
        const engine = resolveFilesEngine(engineFor(args.engine, cfg.files.backend))
        const scope = args.scope || cfg.scopes.defaultScope
        const workspace = await resolveWorkspace(ctx, exec, cfg)
        let dir
        if (scope === 'all' && !args.path) {
          dir = undefined
        } else {
          dir = rootsFor(scope, args.path, cfg, workspace, PLATFORM)[0]
        }
        // 同一类后端共享第一份 transport 配置（0.5.0 描述符化前的已知边界，见 probe.js 的说明）。
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
}
