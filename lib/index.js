import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTools } from './tools.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'local-search'

/** Services required by the tools. */
export const inject = ['tools', 'systemPrompt', 'workingDirectory']

export const Config = z.object({
  esPath: z.string().default('').description('Absolute path to es.exe; empty auto-detects PATH and common install folders.'),
  anytxtUrl: z.string().default('http://127.0.0.1:9920').description('Local Anytxt JSON-RPC endpoint; :9921 is tried as a fallback.'),
  workspaceRoot: z.string().default('').description('Root for scope=workspace; empty uses the session working directory.'),
  workRoot: z.string().default('').description('Root for scope=work; required before using that scope.'),
  personalRoot: z.string().default('').description('Root for scope=personal; required before using that scope.'),
  allRoots: z.string().default('').description('Semicolon-separated roots for Anytxt scope=all; empty uses C: and D: when present.'),
  maxResults: z.number().default(20).description('Default result cap; the hard cap is 100.'),
  timeoutMs: z.number().default(30000).description('Per-call timeout budget in milliseconds.'),
  readMaxChars: z.number().default(8000).description('Default local_search_read window; the hard cap is 20,000 characters.'),
  esEncoding: z.string().default('gbk').description('Code page used to decode es.exe output; zh-CN uses gbk.'),
})

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`dsh-local-search: ${field} must be a positive integer`)
  }
}

/**
 * Validate a candidate config. Shared by activation and the future config
 * page's save/test path; the loader may pass a fresh object on HMR.
 */
export function validateConfig(config) {
  assertPositiveInteger('maxResults', config.maxResults)
  assertPositiveInteger('timeoutMs', config.timeoutMs)
  assertPositiveInteger('readMaxChars', config.readMaxChars)
  if (config.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-local-search: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!/^https?:\/\//i.test(config.anytxtUrl)) {
    throw new Error('dsh-local-search: anytxtUrl must start with http:// or https://')
  }
  return config
}

/**
 * Register the five local-search tools and their routing guidance.
 */
export async function apply(ctx, config) {
  validateConfig(config)

  ctx.effect(() => {
    const disposers = createTools(ctx, config).map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'tool:local_search',
      order: 106,
      text:
        'Use local_search_files for file/folder names or paths, especially outside the workspace or across drives. ' +
        'Use local_search_content for text inside PDF/Office/EPUB/TXT/MD documents or a whole-disk content search, then local_search_fragments or local_search_read for detail. ' +
        'Keep grep/glob for source code and plain text already in the workspace. ' +
        'If a search reports EVERYTHING_DOWN or ANYTXT_DOWN, fall back to grep/glob and say that you fell back.',
    }),
  )
}
