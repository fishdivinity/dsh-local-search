/**
 * 配置页的四条只读路由：`status`（测试连接）、`describe`（页面结构）、`diagnose`（可复制诊断）、
 * `locales`（语言包）。
 *
 * 它们注册在裸 `webServer` 上、用 `exact`，共用同一道门：非 GET/HEAD，以及浏览器标记为跨站的
 * 请求，一律拒；都不发 CORS 头。`?anytxtUrl=` 只接受 loopback 地址（不能当转发代理），
 * `?esPath=` / `?dir=` 只查存在与类型、绝不 spawn 请求里的路径，`?checkOnly=1` 跳过引擎探测。
 */

import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { probeEngines } from './probe.js'
import { isLoopbackUrl } from './config.js'
import { describeConfig } from './describe.js'
import { detect, expandHome, isAbsolutePath } from './platform.js'

/**
 * 本机平台事实取一次：草稿路径按这台机器的写法判绝对，与页面改写路径用的是同一套规则。
 * 进程活着的期间平台不会变，也不必为每条请求重算一遍家目录。
 */
const PLATFORM = detect()

/** 页面取引擎状态用的路径；页面按自己的 base URI 解析它。 */
export const STATUS_ROUTE = '/dsh-local-search/api/status'

/** 页面取后端与字段描述用的路径。 */
export const DESCRIBE_ROUTE = '/dsh-local-search/api/describe'

/** 页面取一份可复制的诊断文本用的路径。 */
export const DIAGNOSE_ROUTE = '/dsh-local-search/api/diagnose'

/** 页面取全部语言包用的路径。 */
export const LOCALES_ROUTE = '/dsh-local-search/api/locales'

/** 携带待探测的未保存地址的查询参数。 */
export const DRAFT_PARAM = 'anytxtUrl'

/** 携带待校验的未保存 `es.exe` 路径的查询参数。 */
export const DRAFT_PATH_PARAM = 'esPath'

/** 携带待校验的未保存目录的查询参数；可重复，`allRoots` 会拆成多条。 */
export const DRAFT_DIR_PARAM = 'dir'

/** 只要校验草稿、不跑引擎探测的查询参数。失焦校验用它，免得一次按键花一次 es.exe 启动。 */
export const CHECK_ONLY_PARAM = 'checkOnly'

/**
 * 写一份 JSON 响应。
 *
 * 默认 `no-store`：答案都是现算的（一次探测、一次读盘），缓存住就会撒谎。可协商的资源在调用处
 * 覆盖——`locales` 用 `no-cache` + ETag，命中 304 就不必重传 body。
 * @param {number} status - 状态码
 * @param {unknown} payload - 要 JSON 化的载荷
 * @param {object} [headers] - 额外的响应头
 */
function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}

/**
 * 只声明可达，不写 body。
 *
 * 这几条路由唯一有用的答案都在 body 里，而构造它要花一次 es.exe 启动、一次探测或一次读盘，
 * 所以 HEAD 一律不付这笔钱。`cacheControl` 由调用方给：可协商的资源要与 GET 说同一句话。
 * @param {object} response - HTTP 响应
 * @param {string} [cacheControl] - 缓存指令，默认 `no-store`
 */
function sendHead(response, cacheControl = 'no-store') {
  response.writeHead(200, { 'cache-control': cacheControl, 'content-type': 'application/json; charset=utf-8' })
  response.end()
}

/**
 * 一个已存在的路径在磁盘上的写法：真实大小写、真实分隔符。
 *
 * 只是锦上添花——页面把 `d:/alpha` 交给这里，回填 `D:\Alpha`；取不到就原样返回，校验结论不受影响。
 * `realpath` 会解析 junction 与符号链接，所以回填的是目标路径本身，两者指向同一棵树。
 * @param value - 已确认存在的绝对路径
 * @returns 规范写法
 */
function canonicalPath(value) {
  try {
    return realpathSync.native(value)
  } catch {
    return value
  }
}

/**
 * 请求目标里的查询参数；解析不了的 URL 当成没有参数。
 * @returns {URLSearchParams}
 */
function queryOf(requestUrl) {
  try {
    return new URL(String(requestUrl ?? '/'), 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * 这次请求只要校验草稿，不要引擎状态吗。
 * @returns 带 `checkOnly` 时为 true
 */
function checkOnly(requestUrl) {
  return queryOf(requestUrl).has(CHECK_ONLY_PARAM)
}

/**
 * 请求是来自本页面而不是别的站点吗。
 * @param {object} request - HTTP 请求（只读 `headers`）
 * @returns 同源请求、或不是浏览器发来的请求时为 true
 */
export function isSameOrigin(request) {
  const headers = request.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '') return site === 'same-origin' || site === 'none'
  const origin = headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * 拒绝一个不该处理的请求：非 GET/HEAD，或浏览器标记为跨站。
 *
 * 四条路由共用同一道门——一次探测要花一次 es.exe 启动，describe / diagnose / locales 也要避免
 * 变成任意站点可读的本机信息口。
 * @returns {boolean} 已经作答、调用方应直接返回时为 true
 */
function refused(request, response) {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return true
  }
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { ok: false, code: 'CROSS_SITE_REFUSED', message: 'this route answers this page only' })
    return true
  }
  return false
}

/**
 * 读出保存前测试要问的那个草稿地址。
 *
 * 它跑的是 config schema 强制的同一条 loopback 规则，所以草稿永远到不了已保存配置都放不下的
 * 地址。
 * @returns {{ok: true, value: string|undefined} | {ok: false}} 草稿，或它被拒的原因
 */
export function draftEndpoint(requestUrl) {
  const raw = queryOf(requestUrl).get(DRAFT_PARAM)
  if (raw === null || raw.trim() === '') return { ok: true, value: undefined }
  const trimmed = raw.trim()
  return isLoopbackUrl(trimmed) ? { ok: true, value: trimmed } : { ok: false }
}

/**
 * 读出保存前要确认的 `es.exe` 草稿路径。
 *
 * 只回答「在不在」，不启动它：路径是调用方给的，按它 spawn 就等于把任意执行开成接口。
 * `~` 先展开再判绝对，与工具侧解析配置的规则一致——否则草稿能过、真检索却找不到文件。
 * `resolved` 是同一个文件的规范写法，页面拿它回填输入框。
 * @returns {{ok: true, value: string|undefined, resolved: string|undefined} | {ok: false, reason: 'missing'|'not-file'}}
 */
export function draftEsPath(requestUrl) {
  const raw = queryOf(requestUrl).get(DRAFT_PATH_PARAM)
  if (raw === null || raw.trim() === '') return { ok: true, value: undefined, resolved: undefined }
  const path = expandHome(raw, PLATFORM)
  if (!isAbsolutePath(path, PLATFORM) || !existsSync(path)) return { ok: false, reason: 'missing' }
  let file = false
  try {
    file = statSync(path).isFile()
  } catch {
    file = false
  }
  // 目录不是文件：这一条对读数的人才说得清楚（「这里要填文件」比「不存在」有用）。
  if (!file) return { ok: false, reason: 'not-file' }
  return { ok: true, value: path, resolved: canonicalPath(path) }
}

/**
 * 读出保存前要确认的目录草稿（可多值，`allRoots` 会拆成多条）。
 *
 * 同样只查存在与「是个目录」：Windows 接受 `/` 与 `\` 两种分隔符，所以 `D:/Alpha` 与
 * `D:\Alpha` 都是合法路径，这里按同一规则判定。绝对与否按目标平台的写法判（`isAbsolutePath`），
 * 不跟 `node:path` 那套跟着真机走的规则，`~` 同样先展开。
 * @returns {{ok: true, value: string[], resolved: string[]} | {ok: false, reason: 'missing'|'not-directory'}}
 */
export function draftDirs(requestUrl) {
  const dirs = queryOf(requestUrl).getAll(DRAFT_DIR_PARAM)
    .map((value) => expandHome(value, PLATFORM))
    .filter((value) => value !== '')
  for (const dir of dirs) {
    if (!isAbsolutePath(dir, PLATFORM) || !existsSync(dir)) return { ok: false, reason: 'missing' }
    let directory = false
    try {
      directory = statSync(dir).isDirectory()
    } catch {
      directory = false
    }
    // 填了具体文件是最常见的错法（粘了一条文件路径进来），单独给一个原因。
    if (!directory) return { ok: false, reason: 'not-directory' }
  }
  return { ok: true, value: dirs, resolved: dirs.map((dir) => canonicalPath(dir)) }
}

/**
 * 载荷构造失败时的统一回答。
 * @param {unknown} error - 抛出来的东西
 * @returns {{ok: false, code: string, message: string}} 500 的载荷
 */
function probeFailure(error) {
  return { ok: false, code: 'PROBE_FAILED', message: error instanceof Error ? error.message : String(error) }
}

/**
 * 跑一次 handler；页面已经走开时断连，不要把拒绝抛回 web server 的请求管线。
 * @param {() => Promise<void>|void} run - 真正的处理
 */
async function guarded(request, response, run) {
  try {
    await run()
  } catch {
    try {
      response.destroy()
    } catch {
      // 已经没了。
    }
  }
}

/**
 * 回答一次探测请求。
 * @param {object} request - HTTP 请求（读 `method` 与 `url`）
 * @param {(options: object) => Promise<{everything: object, anytxt: object}>} probe - 要跑的探测
 */
export async function statusHandler(request, response, probe) {
  await guarded(request, response, () => answerStatus(request, response, probe))
}

/**
 * 草稿被拒：400 加一个稳定的 code，页面据此决定说哪一句。
 * @param {string} code - 机器可读的原因
 * @param {string} message - 英文说明（面向日志与调试，不面向页面）
 */
function refuseDraft(response, code, message) {
  sendJson(response, 400, { ok: false, code, message })
}

/**
 * 写出一次请求的答案。
 * @param {(options: object) => Promise<{everything: object, anytxt: object}>} probe - 要跑的探测
 */
async function answerStatus(request, response, probe) {
  const method = request.method ?? 'GET'
  if (refused(request, response)) return
  // HEAD 只声明可达，不花一次 es.exe 启动：探测就是这条路由的全部成本，而唯一有用的答案在
  // body 里。
  if (method === 'HEAD') {
    sendHead(response)
    return
  }
  const draft = draftEndpoint(request.url)
  if (!draft.ok) {
    refuseDraft(response, 'ANYTXT_URL_REJECTED', 'a draft endpoint must be a loopback http(s) url')
    return
  }
  const path = draftEsPath(request.url)
  if (!path.ok) {
    refuseDraft(
      response,
      path.reason === 'not-file' ? 'ES_PATH_NOT_FILE' : 'ES_PATH_REJECTED',
      path.reason === 'not-file'
        ? 'a draft es.exe path must be a file, not a directory'
        : 'a draft es.exe path must be an absolute existing file',
    )
    return
  }
  const dirs = draftDirs(request.url)
  if (!dirs.ok) {
    refuseDraft(
      response,
      dirs.reason === 'not-directory' ? 'DIR_NOT_DIRECTORY' : 'DIR_REJECTED',
      dirs.reason === 'not-directory'
        ? 'a draft directory must be a directory, not a file'
        : 'a draft directory must be an absolute existing directory',
    )
    return
  }
  // 草稿的规范写法，页面用它回填输入框（`d:/alpha` 落成 `D:\Alpha`）；只要校验时直接作答。
  const drafts = { esPath: path.resolved, dirs: dirs.resolved ?? [] }
  if (checkOnly(request.url)) {
    sendJson(response, 200, { ok: true, drafts })
    return
  }
  let payload
  let status = 200
  try {
    // 这条路由只喂页面，所以可以带上 `detail` 那个原因——面向模型的状态刻意把它留在表面之外。
    const probed = await probe({ anytxtUrl: draft.value, detail: true })
    payload = {
      ok: Boolean(probed.everything?.ok) && Boolean(probed.anytxt?.ok),
      checkedAt: Date.now(),
      everything: probed.everything ?? { ok: false, code: 'UNKNOWN' },
      anytxt: probed.anytxt ?? { ok: false, code: 'UNKNOWN' },
      drafts,
    }
  } catch (error) {
    status = 500
    payload = probeFailure(error)
  }
  sendJson(response, status, payload)
}

/**
 * 注册一条只读 JSON 路由；四个 `registerXxxRoute` 的差异只在 path 与 handler。
 * @param {string} path - 路由路径
 * @param {(request: object, response: object) => Promise<void>} handler - 处理器
 */
function registerJsonRoute(server, path, handler) {
  return server.register({ kind: 'exact', path, handler })
}

/**
 * 把探测路由注册到 Host 的 web server 上。
 * @param {object} config - schema 输出，含 volatile 引用
 * @param {(options: object) => Promise<object>} [probe] - 探测函数，测试可注入
 */
export function registerStatusRoute(server, config, probe = (options) => probeEngines(config, options)) {
  return registerJsonRoute(server, STATUS_ROUTE, (request, response) => statusHandler(request, response, probe))
}

/**
 * 回答一次 describe 请求。
 *
 * 载荷可以是异步的：被 HMR 事务挡回的首用写入在这里补跑（见 `lib/index.js`），页面等它一次，
 * 换回来的是「已经写过」的结论，而不是一张空表单。
 * @param {() => object|Promise<object>} describe - 载荷构造函数
 */
export async function describeHandler(request, response, describe = () => describeConfig()) {
  await guarded(request, response, async () => {
    if (refused(request, response)) return
    if ((request.method ?? 'GET') === 'HEAD') {
      sendHead(response)
      return
    }
    let payload
    try {
      payload = await describe()
    } catch (error) {
      // 与 diagnose 一致：让页面拿到原因，而不是只剩一句「读不到后端列表」。
      sendJson(response, 500, probeFailure(error))
      return
    }
    sendJson(response, 200, payload)
  })
}

/**
 * 把 describe 路由注册到 Host 的 web server 上。
 * @param {() => object} [describe] - 载荷构造函数，测试可注入
 */
export function registerDescribeRoute(server, describe = () => describeConfig()) {
  return registerJsonRoute(server, DESCRIBE_ROUTE, (request, response) => describeHandler(request, response, describe))
}

/**
 * 回答一次 diagnose 请求。
 *
 * 文本每次现算：两个后端并行，最坏约 5 秒，缓存一份就会把「现在到底怎么样」说成上一次的样子。
 * @param {(query: URLSearchParams) => object|Promise<object>} build - 载荷构造函数
 */
export async function diagnoseHandler(request, response, build) {
  await guarded(request, response, async () => {
    if (refused(request, response)) return
    if ((request.method ?? 'GET') === 'HEAD') {
      sendHead(response)
      return
    }
    let status = 200
    let payload
    try {
      // 查询参数原样交给调用方：`shell` / `remote` / `dsh` 只有页面知道，Host 不解析也不回写。
      payload = await build(queryOf(request.url))
    } catch (error) {
      status = 500
      payload = probeFailure(error)
    }
    sendJson(response, status, payload)
  })
}

/**
 * 把 diagnose 路由注册到 Host 的 web server 上。
 * @param {(query: URLSearchParams) => object|Promise<object>} build - 载荷构造函数
 */
export function registerDiagnoseRoute(server, build) {
  return registerJsonRoute(server, DIAGNOSE_ROUTE, (request, response) => diagnoseHandler(request, response, build))
}

/**
 * `if-none-match` 是否点名了这个 ETag。
 *
 * 语言包按内容算哈希，没有需要协商的变体，所以只认精确匹配、弱校验写法与 `*`。
 * @param {string} [header] - 请求头
 * @param {string} etag - 带引号的 ETag
 * @returns {boolean} 命中时为 true
 */
function matchesEtag(header, etag) {
  if (typeof header !== 'string' || header === '') return false
  return header.split(',').some((entry) => {
    const candidate = entry.trim()
    return candidate === '*' || candidate === etag || candidate === `W/${etag}`
  })
}

/**
 * 按语言名排序后重新组装语言包。
 *
 * `JSON.stringify` 保留插入顺序，不排序的话同样内容两次请求会算出两个 ETag，304 永远不命中。
 * @param {object} packs - `read()` 的返回
 * @returns {object} 键顺序稳定的语言包
 */
function orderedPacks(packs) {
  const ordered = {}
  for (const lang of Object.keys(packs ?? {}).sort()) ordered[lang] = packs[lang]
  return ordered
}

/**
 * 回答一次 locales 请求：一次回全部语言包，ETag 是 JSON body 的 sha1。
 *
 * ETag 按内容算而不是按文件的 mtime：语言包是可选的只读层，内容没变就不该让页面重下。
 * @param {() => object} read - 语言包读取函数
 */
export function localesHandler(request, response, read) {
  return guarded(request, response, () => {
    if (refused(request, response)) return
    // HEAD 不读盘、也不带 ETag；缓存指令由 sendHead 与 GET 对齐（no-cache）。
    if ((request.method ?? 'GET') === 'HEAD') {
      sendHead(response, 'no-cache')
      return
    }
    const packs = orderedPacks(read())
    const body = JSON.stringify(packs)
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`
    // 命中就只回头：304 不允许带 body，所以这里不走 sendJson。
    if (matchesEtag(request.headers?.['if-none-match'], etag)) {
      response.writeHead(304, { etag, 'cache-control': 'no-cache' })
      response.end()
      return
    }
    sendJson(response, 200, packs, { etag, 'cache-control': 'no-cache' })
  })
}

/**
 * 把 locales 路由注册到 Host 的 web server 上。
 * @param {() => object} read - 语言包读取函数
 */
export function registerLocalesRoute(server, read) {
  return registerJsonRoute(server, LOCALES_ROUTE, (request, response) => localesHandler(request, response, read))
}
