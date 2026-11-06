import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { release } from 'node:os'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTools } from './tools.js'
import { readConfig, validateConfig } from './config.js'
import { Config } from './schema.js'
import { bootstrap, createDeferredWrite, deferredWrite } from './bootstrap.js'
import { describeConfig } from './describe.js'
import { configFacts, diagnose } from './diagnose.js'
import { detect } from './platform.js'
import { defaultAllRoots, parseAllRoots } from './roots.js'
import { probeEngines, probeSettled, healthFailures } from './probe.js'
import { readLocalePacks } from './locale-packs.js'
import {
  registerDescribeRoute,
  registerDiagnoseRoute,
  registerLocalesRoute,
  registerStatusRoute,
} from './route.js'

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

/** 本插件的版本。诊断文本的第一行，与 package.json 同源。 */
const PLUGIN_VERSION = readVersion(new URL('../package.json', import.meta.url))

export { Config, validateConfig }

/**
 * 读一份 package.json 的 `version`；读不到就返回 undefined，绝不抛。
 * @param {URL|string} location - 文件路径
 * @returns {string|undefined} 版本号
 */
function readVersion(location) {
  try {
    const value = JSON.parse(readFileSync(location, 'utf8')).version
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

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
 * Host 的 DSH 版本：`profileContext.installAnchor` 旁边那份 `package.json`。
 *
 * 这个服务可能整个没有（嵌入式启动），那时整段不出现——不猜、也不拿 Electron 的版本顶替。
 * @param {object|undefined} profile - `profileContext`
 * @returns {string|undefined} 版本号
 */
function dshVersion(profile) {
  const anchor = profile?.installAnchor
  if (typeof anchor === 'string' && anchor !== '') {
    // 锚点可能是安装目录，也可能是目录里的某个文件；两种都试一次。
    for (const directory of [anchor, dirname(anchor)]) {
      const version = readVersion(join(directory, 'package.json'))
      if (version !== undefined) return version
    }
  }
  return typeof profile?.version === 'string' && profile.version !== '' ? profile.version : undefined
}

/**
 * 注册五个本地检索工具、它们的路由提示、首用配置，以及配置页的只读接口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config - schema 输出；volatile 字段是活引用
 */
export async function apply(ctx, config) {
  validateConfig(config, MAX_TIMER_DELAY_MS)

  const platform = detect()
  const profileContext = serviceOf(ctx, 'profileContext')
  const profile = typeof profileContext?.name === 'string' ? profileContext.name : undefined

  // 首用配置的进展要能被 describe 读到，所以先建一个就地更新的状态对象，再由后台任务填。
  // 「引擎坏没坏」不在这一份里：那是每次启动的健康检查（下面的 `health`）。
  const autoconfig = { pending: true, ran: false, deferred: false }
  // 被 HMR 事务挡住时补写的那一次：热装、热卸载都不在冷启动里，挂载这次写不进去（见 lib/bootstrap.js）。
  // 交给第一次页面请求——HTTP 处理器跑在事务之外，配置编辑器才肯落盘。
  let retryAutoconfig = async () => {}
  // 没有 settings 的部署里注入回调永远不会跑：给「还在探测」一个上限，免得 /describe 永远这么报。
  const pendingDeadline = setTimeout(() => { autoconfig.pending = false }, PENDING_GIVE_UP_MS)
  ctx.effect(() => () => { clearTimeout(pendingDeadline) })
  ctx.inject(['settings'], (settingsCtx) => {
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
  // 的顺序并点出回退方案。
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'tool:local_search',
      order: 106,
      text:
        'Names anywhere outside the workspace: local_search_files. ' +
        'Document text (PDF/Office/EPUB, whole disk): local_search_content, then fragments/read. ' +
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
    // 诊断文本每次现算：两个后端并行，最坏约 5 秒（各带一份 PROBE_MAX_MS），所以不缓存，
    // 也不写进任何持久状态。
    const buildDiagnose = async (query) => {
      const cfg = readConfig(config)
      const checkedAt = new Date().toISOString()
      let probed = {}
      try {
        probed = await probeEngines(config, { detail: true })
      } catch (error) {
        ctx.logger?.warn?.('dsh-local-search: diagnose probe failed', error)
      }
      const configuredAll = parseAllRoots(cfg.scopes.allRoots)
      return {
        text: diagnose({
          plugin: PLUGIN_VERSION,
          // 页面报的 DSH 版本优先：Host 侧那个服务不一定有。
          dsh: query.get('dsh') || dshVersion(profileContext),
          shell: query.get('shell') || undefined,
          profile,
          remote: query.get('remote') || undefined,
          os: { platform: process.platform, release: release(), node: process.version },
          engines: probed,
          roots: {
            workspace: cfg.scopes.workspaceRoot || process.cwd(),
            work: cfg.scopes.workRoot,
            personal: cfg.scopes.personalRoot,
            all: configuredAll.length > 0 ? configuredAll : defaultAllRoots(detect()),
            default: cfg.scopes.defaultScope,
          },
          config: configFacts(cfg),
          autoconfig: { ran: autoconfig.ran, deferred: autoconfig.deferred, error: autoconfig.error },
          home: platform.home,
          dshHome: process.env.DSH_HOME,
          checkedAt,
        }),
      }
    }
    // 页面的「测试连接」/提示卡的自愈都走这条路由：它探的是**当前**状态，所以顺手把结论写回
    // `health`——否则第二个客户端（手机、新标签页）读到的仍是启动那一刻的快照。
    // 带草稿地址的那次不写：草稿不代表已保存的配置。
    const statusProbe = async (options) => {
      const probed = await probeEngines(config, options)
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
        registerDiagnoseRoute(server, buildDiagnose),
        registerLocalesRoute(server, () => readLocalePacks()),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'local-search: configuration page routes')
  })
}
