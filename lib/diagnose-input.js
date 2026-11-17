/**
 * 诊断路由的 host 侧装配：读环境、探一次索引，把事实交给 `lib/diagnose.js` 排版。
 *
 * 与 `diagnose.js` 分开是因为职责不同：那份是纯文本格式化（不探测、不 spawn、不读环境，单测
 * 不需要真机），这份要碰 `profileContext`、`package.json`、`process.env` 与一次真实探测。
 *
 * 探测每次现算（并行，最坏一份探测预算），不缓存、也不写任何持久状态。
 */

import { readFileSync } from 'node:fs'
import { release } from 'node:os'
import { dirname, join } from 'node:path'
import { readConfig } from './config.js'
import { configFacts, diagnose } from './diagnose.js'
import { detect } from './platform.js'
import { probeEngines } from './probe.js'
import { defaultAllRoots, parseAllRoots } from './roots.js'

/**
 * `GET /api/diagnose` 的全部输入：由 `apply` 现取，测试可注入 `probe`。
 * @typedef {object} DiagnoseOptions
 * @property {object} config - schema 输出，含 volatile 引用
 * @property {{home: string}} platform - `detect()` 的结果（诊断里要写家目录用于脱敏）
 * @property {object} [profileContext] - 宿主的 profile 上下文（`name` / `installAnchor` / `version`）
 * @property {URLSearchParams} query - 页面的查询串（`dsh` / `shell` / `remote`）
 * @property {{ran: boolean, deferred?: boolean, error?: string}} autoconfig - 首用写回的状态
 * @property {object} [logger] - 只用于记录探测失败
 * @property {(config: object, options: object) => Promise<{engines: Record<string, object>}>} [probe] - 探测实现，测试注入
 */

/** 本插件的版本。模块加载时读一次；读不到就缺这一段，不抛（诊断比版本号重要）。 */
const PLUGIN_VERSION = readVersion(new URL('../package.json', import.meta.url))

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
 * Host 的 DSH 版本：`profileContext.installAnchor` 旁边那份 `package.json`。
 *
 * 这个服务可能整个没有（嵌入式启动），那时整段不出现——不猜、也不拿 Electron 的版本顶替。
 * 每次诊断请求读一次盘（用户点「复制诊断」才发生，量可忽略），不缓存：profile 可能被换。
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
 * 组装 `GET /api/diagnose` 的文本。
 *
 * 输入类型写死成选项对象而不是 `{object}`：路由期望的是 `(query: URLSearchParams) => …`，
 * 把「选项对象」误传给路由在结构类型下必须报错（0.4.4 的 diagnose 500 就是这么漏的）。
 * @param {DiagnoseOptions} options - 见上
 * @returns {Promise<{text: string}>} 纯文本
 */
export async function buildDiagnose({
  config,
  platform,
  profileContext,
  query,
  autoconfig,
  logger,
  probe = probeEngines,
}) {
  const cfg = readConfig(config)
  const checkedAt = new Date().toISOString()
  let probed = {}
  try {
    probed = await probe(config, { detail: true })
  } catch (error) {
    logger?.warn?.('dsh-local-search: diagnose probe failed', error)
  }
  const profile = typeof profileContext?.name === 'string' ? profileContext.name : undefined
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
      engines: probed.engines ?? {},
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
