/**
 * 对两个本地索引各探测一次，供面向模型的 `local_search_status` 工具与配置页的测试按钮共用。
 *
 * 两边回答的是同一个问题——「这台机器现在能连上它的索引吗？」——所以不能漂成两份略有差异的
 * 探测。探测走引擎注册表，新增后端仍然只是 `lib/engines.js` 里的一条。
 */

import { readConfig } from './config.js'
import { resolveContentEngine, resolveFilesEngine } from './engines.js'
import { everythingInstalled } from './everything.js'

/**
 * Everything 这条链上缺的是哪一环。
 *
 * 这个细节是给读配置页的人看的，他能装或能启动点什么；模型只拿两个稳定 code。安装检查本身
 * 就跑不起来时答案是 `unknown`，页面回落到它的通用提示，而不是让一个已经装了的人去安装。
 * @param {string} code - 探测产生的错误码
 * @returns {'not-installed'|'not-running'|'es-missing'|'unknown'} 能照着做的原因
 */
export function diagnoseEverything(code, presence = everythingInstalled()) {
  if (!presence.known) return 'unknown'
  if (!presence.installed) return 'not-installed'
  return code === 'EVERYTHING_ES_NOT_FOUND' ? 'es-missing' : 'not-running'
}

/**
 * 探测配置的索引一次，永不抛异常。
 * @param {object} config - schema 输出，含 volatile 引用
 * @param {object} [options]
 * @param {string} [options.only] - `auto` 两个都探；`anytxt` / `everything` 跳过另一个
 * @param {string} [options.workspace] - 向 Anytxt 询问时用的根
 * @param {string} [options.anytxtUrl] - 要探测的地址，而不是已保存的那个（页面的草稿）
 * @param {boolean} [options.detail] - 给失败的引擎补上页面用的原因
 * @param {AbortSignal} [options.signal] - 调用方的取消
 * @returns {Promise<{everything: object, anytxt: object}>} 两个状态
 */
export async function probeEngines(config, { only = 'auto', workspace, anytxtUrl, signal, detail = false } = {}) {
  const cfg = readConfig(config)
  const everything = { ok: false }
  const anytxt = { ok: false }
  const budget = Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : 5000
  // 探测是诊断而不是检索：除了上限还得有下限，否则一个很小的 timeoutMs 会把健康的引擎报成
  // DOWN。
  const probeBudget = Math.max(1500, Math.min(budget, 5000))

  if (only !== 'anytxt') {
    try {
      Object.assign(everything, await resolveFilesEngine('everything').status({
        esPath: cfg.files.everything.esPath,
        timeoutMs: probeBudget,
        signal,
        encoding: cfg.files.everything.esEncoding,
      }))
    } catch (error) {
      everything.code = error.code || 'EVERYTHING_DOWN'
      everything.message = error.message
      if (detail && everything.code !== 'EVERYTHING_ABORTED') everything.detail = diagnoseEverything(everything.code)
    }
  } else {
    everything.code = 'SKIPPED'
    everything.message = 'not checked because engine=anytxt'
  }

  if (only !== 'everything') {
    try {
      Object.assign(anytxt, await resolveContentEngine('anytxt').status({
        url: anytxtUrl || cfg.content.anytxt.url,
        root: workspace || cfg.scopes.workspaceRoot || process.cwd(),
        timeoutMs: probeBudget,
        signal,
      }))
    } catch (error) {
      anytxt.code = error.code || 'ANYTXT_DOWN'
      anytxt.message = error.message
    }
  } else {
    anytxt.code = 'SKIPPED'
    anytxt.message = 'not checked because engine=everything'
  }

  return { everything, anytxt }
}
