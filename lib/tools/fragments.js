import { defineTool } from '@deepseek-ai/dsh-tools'
import { readConfig } from '../config.js'
import { resolveContentEngine } from '../engines.js'
import { EngineError } from '../errors.js'
import { formatFragments } from '../format.js'
import { parseRef, assertRefEngine } from '../ref.js'
import { clampCount, guard, requireQuery } from './shared.js'

const MAX_FRAGMENTS = 20

/**
 * 一个已索引文档里命中处附近的片段。
 * @param {import('./shared.js').ToolDeps} deps - 运行时上下文与注册时固定的快照
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 片段工具
 */
export function createFragmentsTool({ config, initial }) {
  return defineTool({
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
    output: {
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
    },
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
}
