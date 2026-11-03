/**
 * 对两个本地索引各探测一次，供面向模型的 `local_search_status` 工具与配置页的测试按钮共用。
 *
 * 这里只汇总与归一：每个后端自己判四态（`ready` / `missing-tool` / `missing-index` / `down`），
 * 本模块把它们收成两种视图——给模型的那份只要「能不能用」，给用户看的那份多一个「为什么」。
 * 两种视图的界不许往回走；`test/format.test.js` 钉着给模型的那份。
 */

import { readConfig } from './config.js'
import { resolveContentEngine, resolveFilesEngine } from './engines.js'
import { PROBE_MAX_MS, PROBE_MIN_MS } from './limits.js'

/**
 * 后端探测结果 → 一种视图里的状态。
 *
 * `detail: false` 是给模型的那份：只留 `ok` 与版本 / 路径 / 地址，绝不带 `state` / `detail`——
 * 模型手里有 pwsh / grep / glob，看到「缺工具」就会去装一个，而正确动作是退回 grep / glob 并说
 * 一句本机检索不可用。`detail: true` 是给用户看的那份：多 `state`，失败项再多 `detail`。
 * @param {object} result - 后端 `probe()` 的返回
 * @param {boolean} [detail] - 要给用户看的那份（模型那份不带 `state` / `detail`）
 * @returns {{ok: boolean}} `{ ok: true, version?, path?, url? }` 或 `{ ok: false, code, message }`
 */
export function toStatus(result, detail = false) {
  if (result?.state === 'ready') {
    const ready = { ok: true }
    // 键按后端真有的那个来：文件名后端有 version / path，内容后端有 url。
    for (const key of ['version', 'path', 'url']) {
      if (result[key] !== undefined) ready[key] = result[key]
    }
    if (detail) ready.state = 'ready'
    return ready
  }
  const failed = { ok: false, code: result?.code, message: result?.message }
  if (detail) {
    failed.state = result?.state
    failed.detail = result?.detail
    // 「试的是哪个地址」只给用户看的那份：诊断文本要靠它区分「端口写错了」和「服务没开」。
    if (result?.url !== undefined) failed.url = result.url
    if (Array.isArray(result?.tried)) failed.tried = result.tried
  }
  return failed
}

/**
 * 后端的 `probe()` 约定永不抛；这里挡的是新后端没守约定——一个坏探针不该把另一个后端的结果
 * 一起丢掉。落到这里的错误连「哪一环坏了」都说不清，所以只报 `down` / `unknown`。
 * @param {() => Promise<object>} run - 调用后端探针
 * @returns {Promise<object>} 后端探针的返回，或一个兜底的四态
 */
async function safely(run) {
  try {
    return await run()
  } catch (error) {
    return {
      state: 'down',
      detail: 'unknown',
      code: error?.code || 'LOCAL_SEARCH_ERROR',
      message: error?.message,
    }
  }
}

/**
 * 探测配置的索引一次，永不抛异常。
 * @param {object} config - schema 输出，含 volatile 引用
 * @param {object} [options] - only（`auto` / `anytxt` / `everything`）/ workspace / anytxtUrl /
 *   detail / signal
 * @returns {Promise<{everything: object, anytxt: object}>} 两个状态
 */
export async function probeEngines(config, { only = 'auto', workspace, anytxtUrl, signal, detail = false } = {}) {
  const cfg = readConfig(config)
  const budget = Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : 5000
  // 探测是诊断而不是检索：除了上限还得有下限，否则一个很小的 timeoutMs 会把健康的引擎报成
  // DOWN。两个后端并行跑，所以整次探测的上限就是这个预算，不是两份相加。
  const probeBudget = Math.max(PROBE_MIN_MS, Math.min(budget, PROBE_MAX_MS))
  const skipped = (message) => ({ ok: false, code: 'SKIPPED', message })
  // 后端探针约定永不抛；`safely` 只挡「抛了」，不挡「不返回」——新后端必须自己守住 timeoutMs。
  const [everything, anytxt] = await Promise.all([
    only === 'anytxt'
      ? skipped('not checked because engine=anytxt')
      : safely(() =>
          resolveFilesEngine('everything').probe({
            esPath: cfg.files.everything.esPath,
            timeoutMs: probeBudget,
            signal,
            encoding: cfg.files.everything.esEncoding,
          }),
        ).then((result) => toStatus(result, detail)),
    only === 'everything'
      ? skipped('not checked because engine=everything')
      : safely(() =>
          resolveContentEngine('anytxt').probe({
            url: anytxtUrl || cfg.content.anytxt.url,
            root: workspace || cfg.scopes.workspaceRoot || process.cwd(),
            timeoutMs: probeBudget,
            signal,
          }),
        ).then((result) => toStatus(result, detail)),
  ])
  return { everything, anytxt }
}
