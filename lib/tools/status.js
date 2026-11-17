import { defineTool } from '@deepseek-ai/dsh-tools'
import { readConfig } from '../config.js'
import { engineEntries, engineNames } from '../engines.js'
import { formatStatus } from '../format.js'
import { engineLabel } from '../labels.js'
import { probeEngines } from '../probe.js'
import { allRootsFor } from '../roots.js'
import { guard, resolveWorkspace, validateEngine } from './shared.js'

/** `engine` 可以取的值：auto + 注册表里全部后端。 */
const STATUS_ENGINES = ['auto', ...new Set([...engineNames().files, ...engineNames().content])]

/**
 * 后端状态：探一次注册表里每个后端，再附上配置的根。
 * @param {import('./shared.js').ToolDeps} deps - 运行时上下文与注册时固定的快照
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} 状态工具
 */
export function createStatusTool({ ctx, config, initial, names }) {
  return defineTool({
    name: 'local_search_status',
    description:
      `Use this when a search reports a *_DOWN code, or before a large batch, to check whether the search backends (${engineEntries().map(({ id }) => engineLabel(id)).join(', ')}) are reachable. ` +
      'Returns each backend status plus the configured search roots.',
    parameters: {
      engine: {
        type: 'string',
        description: `auto (default), ${[...names.files, ...names.content].join(', ')}. Limit the probe to one engine.`,
      },
    },
    timeoutMs: initial.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      return guard(async () => {
        const cfg = readConfig(config)
        const engine = validateEngine(args.engine, STATUS_ENGINES)
        let workspace = cfg.scopes.workspaceRoot || ctx.workingDirectory?.defaultDirectory || process.cwd()
        try {
          workspace = await resolveWorkspace(ctx, exec, cfg)
        } catch {
          // 工作区没了也得把引擎报出来。
        }

        // 与配置页测试按钮要的是同一个探测。
        const probed = await probeEngines(config, {
          only: engine,
          workspace,
          signal: exec.signal,
        })

        // status 里的 all 要反映「省略 scope 时实际会搜哪里」：配置的根全部不在时同样退回
        // workspace，并标出来——否则模型看到 all=D:\Projects，真实调用却搜的是 workspace。
        const resolvedAll = allRootsFor(cfg, workspace)
        return {
          text: formatStatus(
            {
              engines: probed.engines,
              roots: {
                workspace,
                work: cfg.scopes.workRoot,
                personal: cfg.scopes.personalRoot,
                all: resolvedAll.roots,
                allFallback: resolvedAll.fellBack,
                allMissing: resolvedAll.fellBack ? [] : resolvedAll.missing,
                default: cfg.scopes.defaultScope,
              },
            },
            { entries: engineEntries(), names: engineNames() },
          ),
        }
      })
    },
  })
}
