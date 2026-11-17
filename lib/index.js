import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTools } from './tools.js'
import { readConfig, validateConfig } from './config.js'
import { Config } from './schema.js'
import { bootstrap, createDeferredWrite, deferredWrite } from './bootstrap.js'
import { describeConfig } from './describe.js'
import { buildDiagnose } from './diagnose-input.js'
import { detect } from './platform.js'
import { probeEngines, probeSettled, healthFailures } from './probe.js'
import { readLocalePacks } from './locale-packs.js'
import {
  registerDescribeRoute,
  registerDiagnoseRoute,
  registerLocalesRoute,
  registerStatusRoute,
} from './route.js'
import { declareOwnSettingsPage } from './settings-page.js'

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

/**
 * 页面肯为一次补写等多久。
 *
 * 补写要走一次探测（两个后端并行，最坏约 5 秒），引擎挂着时不该让表单空转半分钟；等不到就先答，
 * 写在后台继续。冷启动那次不走这条路，这个值只影响「热挂载后第一次打开页面」。
 */
const RETRY_WAIT_MS = 5000

export { Config, validateConfig }

/**
 * 拿一个服务，拿不到（或宿主没有 `get`）就算了。
 * @param {object} ctx - Cordis 上下文
 * @param {string} service - 服务名
 * @returns {object|undefined} 服务实例
 */
function serviceOf(ctx, service) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(service) : undefined
  } catch {
    return undefined
  }
}

/**
 * 运行时的 Context 比 cordis 声明里多两件事：根上下文挂着 loader（宿主的行为），`effect` 允许
 * fire-and-forget——首次配置那次写入没有 disposer 可返回，运行时接受，声明里只收 Effect。
 * 这两条是「照运行时事实写的逃生口」，宿主修好声明后应当删掉，别让它们长期替声明兜底。
 * @typedef {import('@deepseek-ai/cordis').Context & {
 *   root: import('@deepseek-ai/cordis').Context & {loader?: {await?: () => Promise<unknown>}},
 *   effect: (execute: () => void, label?: string) => unknown,
 * }} PluginContext
 */

/**
 * 注册五个本地检索工具、它们的路由提示、首用配置，以及配置页的只读接口。
 *
 * 第三个参数只给测试：`probe` 是装配测试的注入点（探一次真索引会让单测变成环境依赖）。生产里
 * loader 只传前两个参数，默认值就是真实探测。
 * @param {PluginContext} ctx
 * @param {object} config - schema 输出；volatile 字段是活引用
 * @param {{probe?: typeof probeEngines}} [overrides] - 测试注入的探测实现
 */
export async function apply(ctx, config, { probe = probeEngines } = {}) {
  validateConfig(config, MAX_TIMER_DELAY_MS)

  const platform = detect()
  const profileContext = serviceOf(ctx, 'profileContext')

  // 首用配置的进展要能被 describe 读到，所以先建一个就地更新的状态对象，再由后台任务填。
  // 「引擎坏没坏」不在这一份里：那是每次启动的健康检查（下面的 `health`）。
  const autoconfig = { pending: true, ran: false, deferred: false }
  // 被 HMR 事务挡住时补写的那一次：热装、热卸载都不在冷启动里，挂载这次写不进去（见 lib/bootstrap.js）。
  // 交给第一次页面请求——HTTP 处理器跑在事务之外，配置编辑器才肯落盘。
  // 声明取两端的并集：初始的空 async 返回 void，补写入口返回 unknown，写成其中一边都会被另一端拒。
  /** @type {(() => Promise<unknown>) | (() => Promise<void>)} */
  let retryAutoconfig = async () => {}
  // 没有 settings 的部署里注入回调永远不会跑：给「还在探测」一个上限，免得 /describe 永远这么报。
  const pendingDeadline = setTimeout(() => { autoconfig.pending = false }, PENDING_GIVE_UP_MS)
  ctx.effect(() => () => { clearTimeout(pendingDeadline) })
  ctx.inject(['settings'], /** @param {PluginContext} settingsCtx */ (settingsCtx) => {
    // 页面自带表单，声明一下，免得 DSH 将来按 schema 自动生成第二套写入口。
    settingsCtx.effect(() => declareOwnSettingsPage(ctx, settingsCtx), 'local-search: own settings page')
    // 结果统一在这里落到 describe 读的那个对象上；写回失败要能被页面说出来，只记日志等于没报。
    const record = (state) => {
      autoconfig.ran = state.ran
      autoconfig.deferred = state.deferred === true
      autoconfig.error = state.error
      if (state.written.length > 0) {
        ctx.logger?.info?.('dsh-local-search: startup write: %s', state.written.join(', '))
      }
      return state
    }
    const run = () => bootstrap({ settings: settingsCtx.get('settings'), ns: ENTRY_ID, config, logger: ctx.logger })
      .then(record)
    const fail = (error) => {
      autoconfig.error = String(error?.message ?? error)
      // 还是被事务挡着就留着标记，下次页面请求再试；真被拒绝（例如 home patch 覆盖）就到此为止。
      autoconfig.deferred = deferredWrite(error)
      // 启动配置失败只降级：工具照旧读配置，只是旧键留在原地。
      ctx.logger?.warn?.('dsh-local-search: first-run configuration failed', error)
    }
    retryAutoconfig = createDeferredWrite(autoconfig, () => run().catch(fail))
    settingsCtx.effect(() => {
      // 迁移旧键 → 按需探测 → 写回。
      //
      // 必须等 loader 把每一行都安顿好：settings.describe() 只列已经激活的行，而自己这行在
      // apply 期间还没进入 active 状态，早跑一步就会「找不到可写的命名空间」并静默跳过。
      // dsh-settings 迁移 settings.yaml 用的也是这个时机。
      const loader = ctx.root?.loader
      const settled = typeof loader?.await === 'function' ? loader.await() : Promise.resolve()
      void settled
        .then(run)
        .catch(fail)
        .finally(() => {
          autoconfig.pending = false
        })
    }, 'local-search: first-run configuration')
  })

  // 每次启动的健康检查：开关开着就探一次，结果只进 describe 的 health，不写配置。
  // 首用那一次不受开关影响——它要写值，与「要不要提醒」无关。
  //
  // 两件事都是为了不把瞬时失败报成故障：等 loader 安顿再探（刚启动时整机最忙），
  // 失败后隔 3 秒再探一次（见 `probeSettled`）。
  const health = { pending: true, failures: [], checkedAt: undefined, disabled: false }
  ctx.effect(() => {
    const controller = new AbortController()
    const enabled = readConfig(config).checkEnginesOnStart !== false
    if (!enabled) {
      health.disabled = true
      health.pending = false
      return () => {}
    }
    const loader = ctx.root?.loader
    const settled = typeof loader?.await === 'function' ? loader.await() : Promise.resolve()
    void settled
      .then(() => (controller.signal.aborted ? undefined : probeSettled(config, { signal: controller.signal })))
      .then((probed) => {
        if (probed === undefined) return
        health.failures = healthFailures(probed)
        health.checkedAt = new Date().toISOString()
      })
      .catch((error) => {
        // 探测本身失败不写进 failures：那不是「引擎坏了」的证据，只留一条日志。
        if (controller.signal.aborted) return
        ctx.logger?.warn?.('dsh-local-search: startup health check failed', error)
      })
      .finally(() => {
        health.pending = false
      })
    return () => controller.abort()
  }, 'local-search: startup health check')

  ctx.effect(() => {
    const disposers = createTools(ctx, config).map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // 这是路由提示，不是工具目录：每个工具的 description 已经说了自己是干什么的，这里只排选择
  // 的顺序并点出回退方案。docx 那句是跟自带的 office-docx skill 抢的：那个 skill 默认
  // python-docx，纯取正文比 content → read 贵，所以优先与回退都写在这里。
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'tool:local_search',
      order: 106,
      text:
        'Names anywhere outside the workspace: local_search_files. ' +
        'Document text (PDF/Office/EPUB, whole disk): local_search_content, then fragments/read. ' +
        'Prefer those for text-only extraction; run a python-docx script only for tables/runs/styles, edits, a just-edited file or an index miss. ' +
        'Workspace code and text: grep/glob. ' +
        'On *_DOWN, fall back to grep/glob and say so. ' +
        'Do not install, start or reconfigure these engines: name the backend that is down and point the user at the plugin card.',
    }),
  )

  // 配置页的几个只读接口：页面不能自己 POST 本机 Anytxt JSON-RPC，也无法知道装了哪些后端，
  // 所以由 Host 代答。没有 web server 的部署就没有这些接口，也没有页面。
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.get('webServer')
    // 页面加载就是「每次挂载后第一次有机会在事务之外写 profile 的时刻」：被 HMR 挡回的补写在这里落地，
    // 所以这次 describe 先等它一会儿，页面拿到的才是写过之后的结论。
    //
    // 只等这么久：补写要探测，最坏一个探测预算（≤5 秒），引擎挂着时不该让表单空转。
    // 没等到就让这次 describe 先答，写在后台继续，下次打开页面就是了。
    const settle = () => {
      let timer
      const waited = new Promise((resolve) => {
        timer = setTimeout(resolve, RETRY_WAIT_MS)
        timer.unref?.()
      })
      return Promise.race([retryAutoconfig(), waited]).finally(() => clearTimeout(timer))
    }
    const describe = async () => {
      await settle()
      return describeConfig({
        autoconfig: { pending: autoconfig.pending, ran: autoconfig.ran, deferred: autoconfig.deferred, error: autoconfig.error },
        health: { ...health },
        platform,
      })
    }
    // 诊断文本的组装与探测都在 `diagnose-input.js`：启动入口只把当前事实递过去。
    const diagnoseRoute = (query) => buildDiagnose({
      config,
      platform,
      profileContext,
      query,
      autoconfig,
      logger: ctx.logger,
      probe,
    })
    // 页面的「测试连接」/提示卡的自愈都走这条路由：它探的是**当前**状态，所以顺手把结论写回
    // `health`——否则第二个客户端（手机、新标签页）读到的仍是启动那一刻的快照。
    // 带草稿地址的那次不写：草稿不代表已保存的配置。
    const statusProbe = async (options) => {
      const probed = await probe(config, options)
      if (health.pending !== true && options?.anytxtUrl === undefined) {
        health.failures = healthFailures(probed)
        health.checkedAt = new Date().toISOString()
      }
      return probed
    }
    webCtx.effect(() => {
      const disposers = [
        registerStatusRoute(server, config, statusProbe),
        registerDescribeRoute(server, describe),
        registerDiagnoseRoute(server, diagnoseRoute),
        registerLocalesRoute(server, () => readLocalePacks()),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'local-search: configuration page routes')
  })
}
