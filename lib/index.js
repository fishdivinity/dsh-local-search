import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTools } from './tools.js'
import { validateConfig } from './config.js'
import { registerStatusRoute } from './route.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'local-search'

/** Services required by the tools. */
export const inject = ['tools', 'systemPrompt', 'workingDirectory']

// Every field the Plugins page edits is volatile: that is what makes the
// settings namespace served and a page write accepted. timeoutMs stays a
// fixed number because tool registration captures it (see lib/config.js).
// esEncoding stays a plain string on purpose: 0.1 accepted any label and fell
// back to UTF-8 in `decodeEs`, so narrowing it to a union would refuse to
// activate a profile that worked yesterday. The page offers the two labels
// that matter; YAML keeps the old tolerance.
export const Config = z.object({
  esPath: z.string().default('').volatile().description('Absolute path to es.exe; empty auto-detects PATH and common install folders.'),
  anytxtUrl: z.string().default('http://127.0.0.1:9920').volatile().description('Local Anytxt JSON-RPC endpoint on this machine (127.0.0.1, localhost or [::1]); :9921 is tried as a fallback.'),
  workspaceRoot: z.string().default('').volatile().description('Root for scope=workspace; empty uses the session working directory.'),
  workRoot: z.string().default('').volatile().description('Root for scope=work; required before using that scope.'),
  personalRoot: z.string().default('').volatile().description('Root for scope=personal; required before using that scope.'),
  allRoots: z.string().default('').volatile().description('Semicolon-separated roots for Anytxt scope=all; empty uses C: and D: when present.'),
  maxResults: z.number().min(1).max(100).default(20).volatile().description('Default result cap; the hard cap is 100.'),
  timeoutMs: z.number().default(30000).description('Per-call timeout budget in milliseconds; profile YAML only, because each tool fixes its deadline at registration.'),
  readMaxChars: z.number().min(1).max(20000).default(8000).volatile().description('Default local_search_read window; the hard cap is 20,000 characters.'),
  esEncoding: z.string().default('gbk').volatile().description('Code page used to decode es.exe output: gbk for a zh-CN console, utf-8 otherwise. Any TextDecoder label is accepted; the page offers these two.'),
})

export { validateConfig }

/**
 * Register the five local-search tools, their routing guidance, and the
 * configuration page's probe route.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config - schema output; volatile fields are live references
 */
export async function apply(ctx, config) {
  validateConfig(config, MAX_TIMER_DELAY_MS)

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

  // The configuration page's Test control: the browser cannot call the local
  // Anytxt JSON-RPC itself, so the Host answers for it. A deployment without a
  // web server simply has no Test control and no route.
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.get('webServer')
    webCtx.effect(
      () => registerStatusRoute(server, config),
      'local-search: configuration page probe route',
    )
  })
}
