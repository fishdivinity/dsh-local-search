import { defineTool } from '@deepseek-ai/dsh-tools'
import { readConfig } from '../config.js'
import { resolveContentEngine } from '../engines.js'
import { EngineError } from '../errors.js'
import { formatRead } from '../format.js'
import { MAX_READ } from '../limits.js'
import { parseRef, assertRefEngine } from '../ref.js'
import { clampCount, clampOffset, guard } from './shared.js'

/**
 * 一份已索引文档的正文摘录（按字符窗口）。
 * @param {import('./shared.js').ToolDeps} deps - 运行时上下文与注册时固定的快照
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 读取工具
 */
export function createReadTool({ config, initial }) {
  return defineTool({
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
    output: {
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
    },
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
}
