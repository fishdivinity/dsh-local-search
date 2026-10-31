import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTools } from './tools.js'
import { validateConfig } from './config.js'
import { Config } from './schema.js'
import { bootstrap } from './bootstrap.js'
import { describeConfig } from './describe.js'
import { registerDescribeRoute, registerStatusRoute } from './route.js'

/** Loader 诊断里用的 Cordis 插件名。 */
export const name = 'local-search'

/** 工具需要的服务。 */
export const inject = ['tools', 'systemPrompt', 'workingDirectory']

/** profile 行 id，同时也是设置命名空间与卡片 id；三者必须一致。 */
export const ENTRY_ID = 'fishdivinity-local-search'

/**
 * 「还在探测」对外最多声称多久。
 *
 * 注入回调只有在 settings 服务出现时才跑；部署里根本没有这个服务时它永远不来，`describe`
 * 就会一直报 `autoconfig.pending`。10 秒足够覆盖正常的 loader 安顿 + 一次探测。
 */
const PENDING_GIVE_UP_MS = 10000

export { Config, validateConfig }

/**
 * 注册五个本地检索工具、它们的路由提示、首用配置，以及配置页的两个只读接口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config - schema 输出；volatile 字段是活引用
 */
export async function apply(ctx, config) {
  validateConfig(config, MAX_TIMER_DELAY_MS)

  // 首用配置的进展要能被 describe 读到，所以先建一个就地更新的状态对象，再由后台任务填。
  const autoconfig = { pending: true, ran: false, failures: [] }
  // 没有 settings 的部署里注入回调永远不会跑：给「还在探测」一个上限，免得 /describe 永远这么报。
  const pendingDeadline = setTimeout(() => { autoconfig.pending = false }, PENDING_GIVE_UP_MS)
  ctx.effect(() => () => { clearTimeout(pendingDeadline) })
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      // 迁移旧键 → 按需探测 → 写回。
      //
      // 必须等 loader 把每一行都安顿好：settings.describe() 只列已经激活的行，而自己这行在
      // apply 期间还没进入 active 状态，早跑一步就会「找不到可写的命名空间」并静默跳过。
      // dsh-settings 迁移 settings.yaml 用的也是这个时机。
      const loader = ctx.root?.loader
      const settled = typeof loader?.await === 'function' ? loader.await() : Promise.resolve()
      void settled
        .then(() => bootstrap({ settings: settingsCtx.get('settings'), ns: ENTRY_ID, config, logger: ctx.logger }))
        .then((state) => {
          autoconfig.ran = state.ran
          autoconfig.failures = state.failures
          // 写回失败在页面上看不出来：把错误带进 describe，排查时不用猜。
          autoconfig.error = state.error
          if (state.written.length > 0) {
            ctx.logger?.info?.('dsh-local-search: startup write: %s', state.written.join(', '))
          }
        })
        .catch((error) => {
          // 启动配置失败只降级：工具照旧读配置，只是旧键留在原地。
          ctx.logger?.warn?.('dsh-local-search: first-run configuration failed', error)
        })
        .finally(() => {
          autoconfig.pending = false
        })
    }, 'local-search: first-run configuration')
  })

  ctx.effect(() => {
    const disposers = createTools(ctx, config).map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // 这是路由提示，不是工具目录：每个工具的 description 已经说了自己是干什么的，这里只排选择
  // 的顺序并点出回退方案。四句、约 250 字符——同样的决策，字数只有上一版的一半。
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'tool:local_search',
      order: 106,
      text:
        'Names anywhere outside the workspace: local_search_files. ' +
        'Document text (PDF/Office/EPUB, whole disk): local_search_content, then fragments/read. ' +
        'Workspace code and text: grep/glob. ' +
        'On *_DOWN, fall back to grep/glob and say so.',
    }),
  )

  // 配置页的两个只读接口：页面不能自己 POST 本机 Anytxt JSON-RPC，也无法知道装了哪些后端，
  // 所以由 Host 代答。没有 web server 的部署就没有这两个接口，也没有页面。
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.get('webServer')
    const describe = () => describeConfig({
      pending: autoconfig.pending,
      ran: autoconfig.ran,
      failures: autoconfig.failures,
    })
    webCtx.effect(() => {
      const disposeStatus = registerStatusRoute(server, config)
      const disposeDescribe = registerDescribeRoute(server, describe)
      return () => {
        disposeStatus()
        disposeDescribe()
      }
    }, 'local-search: configuration page routes')
  })
}
