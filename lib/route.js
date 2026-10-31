/**
 * 配置页的测试按钮有一件事浏览器自己做不到：调本机的 Anytxt JSON-RPC 与 `es.exe`，并报告
 * 它们有没有应答。页面往 `127.0.0.1:9920` 发的跨源 POST 两边都会拒，所以页面改问 Host。
 *
 * 路由注册在裸 `webServer` 上、用 `exact`——与其他已安装插件用的是同一个接缝（prefix/exact
 * 注册从不经过 shell 的 `/api` 围栏）。它是只读的，也不发 CORS 头，所以外站页面读不到答案。
 *
 * 外站页面仍然**能**发一个普通 GET，而这里的一次 GET 要花一次 es.exe 启动，所以路由拒掉任何
 * 浏览器标成跨站的请求（`Sec-Fetch-Site`），以及 `Origin` 不是本 Host 的请求。非浏览器的调用方
 * 两个头都不发，它是本地进程，不在页面那个 CSRF 风险的覆盖范围里。
 *
 * `?anytxtUrl=` 让页面测试用户保存前敲下的地址。那份草稿是不可信输入，所以只接受 loopback 的
 * `http(s)` URL：够敲 `127.0.0.1:9921` 试一下，永远不是一个请求转发代理。不带这个参数时路由
 * 探测已保存的配置；一份不是本机的已保存地址会在引擎里以 `ANYTXT_ENDPOINT_REMOTE` 失败。
 *
 * `?esPath=` 让页面在保存前确认「这个路径在不在」。这里**只查文件存在**，绝不启动它：让一条
 * HTTP 路由按请求里的路径去 spawn，等于把任意执行开成了接口。`?dir=`（可重复）同理，只回答
 * 「这个目录在不在」，给检索范围那几个字段用。
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { probeEngines } from './probe.js'
import { isLoopbackUrl } from './config.js'
import { describeConfig } from './describe.js'

/** 页面取引擎状态用的路径；页面按自己的 base URI 解析它。 */
export const STATUS_ROUTE = '/dsh-local-search/api/status'

/** 页面取后端与字段描述用的路径。 */
export const DESCRIBE_ROUTE = '/dsh-local-search/api/describe'

/** 携带待探测的未保存地址的查询参数。 */
export const DRAFT_PARAM = 'anytxtUrl'

/** 携带待校验的未保存 `es.exe` 路径的查询参数。 */
export const DRAFT_PATH_PARAM = 'esPath'

/** 携带待校验的未保存目录的查询参数；可重复，`allRoots` 会拆成多条。 */
export const DRAFT_DIR_PARAM = 'dir'

/** 只要校验草稿、不跑引擎探测的查询参数。失焦校验用它，免得一次按键花一次 es.exe 启动。 */
export const CHECK_ONLY_PARAM = 'checkOnly'

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
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
 * @param {string} requestUrl - 请求目标
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
 * @param {string} requestUrl - 请求目标
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
 * 两条路由共用同一道门——一次探测要花一次 es.exe 启动，describe 也要避免变成任意站点可读的
 * 本机信息口。
 * @param {object} request - HTTP 请求
 * @param {object} response - HTTP 响应
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
 * @param {string} requestUrl - 请求目标
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
 * `resolved` 是同一个文件的规范写法，页面拿它回填输入框。
 * @param {string} requestUrl - 请求目标
 * @returns {{ok: true, value: string|undefined, resolved: string|undefined} | {ok: false, reason: 'missing'|'not-file'}}
 */
export function draftEsPath(requestUrl) {
  const raw = queryOf(requestUrl).get(DRAFT_PATH_PARAM)
  if (raw === null || raw.trim() === '') return { ok: true, value: undefined, resolved: undefined }
  const trimmed = raw.trim()
  if (!isAbsolute(trimmed) || !existsSync(trimmed)) return { ok: false, reason: 'missing' }
  let file = false
  try {
    file = statSync(trimmed).isFile()
  } catch {
    file = false
  }
  // 目录不是文件：这一条对读数的人才说得清楚（「这里要填文件」比「不存在」有用）。
  if (!file) return { ok: false, reason: 'not-file' }
  return { ok: true, value: trimmed, resolved: canonicalPath(trimmed) }
}

/**
 * 读出保存前要确认的目录草稿（可多值，`allRoots` 会拆成多条）。
 *
 * 同样只查存在与「是个目录」：Windows 接受 `/` 与 `\` 两种分隔符，所以 `D:/Alpha` 与
 * `D:\Alpha` 都是合法路径，这里按同一规则判定。
 * @param {string} requestUrl - 请求目标
 * @returns {{ok: true, value: string[], resolved: string[]} | {ok: false, reason: 'missing'|'not-directory'}}
 */
export function draftDirs(requestUrl) {
  const dirs = queryOf(requestUrl).getAll(DRAFT_DIR_PARAM)
    .map((value) => value.trim())
    .filter((value) => value !== '')
  for (const dir of dirs) {
    if (!isAbsolute(dir) || !existsSync(dir)) return { ok: false, reason: 'missing' }
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
 * 回答一次探测请求。
 * @param {object} request - HTTP 请求（读 `method` 与 `url`）
 * @param {object} response - HTTP 响应
 * @param {(options: object) => Promise<{everything: object, anytxt: object}>} probe - 要跑的探测
 */
export async function statusHandler(request, response, probe) {
  try {
    await answerStatus(request, response, probe)
  } catch {
    // 探测到一半页面就走了，socket 已经是死的；这里让 promise 拒掉的话，会在 web server 的
    // 请求管线里冒成一个未处理的 rejection。
    try {
      response.destroy()
    } catch {
      // 已经没了。
    }
  }
}

/**
 * 草稿被拒：400 加一个稳定的 code，页面据此决定说哪一句。
 * @param {object} response - HTTP 响应
 * @param {string} code - 机器可读的原因
 * @param {string} message - 英文说明（面向日志与调试，不面向页面）
 */
function refuseDraft(response, code, message) {
  sendJson(response, 400, { ok: false, code, message })
}

/**
 * 写出一次请求的答案。
 * @param {object} request - HTTP 请求
 * @param {object} response - HTTP 响应
 * @param {(options: object) => Promise<{everything: object, anytxt: object}>} probe - 要跑的探测
 */
async function answerStatus(request, response, probe) {
  const method = request.method ?? 'GET'
  if (refused(request, response)) return
  // HEAD 只声明可达，不花一次 es.exe 启动：探测就是这条路由的全部成本，而唯一有用的答案在
  // body 里。
  if (method === 'HEAD') {
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
    response.end()
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
    payload = { ok: false, code: 'PROBE_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
  sendJson(response, status, payload)
}

/**
 * 把探测路由注册到 Host 的 web server 上。
 * @param {object} server - 解析出的 `webServer` 服务
 * @param {object} config - schema 输出，含 volatile 引用
 * @param {(options: object) => Promise<object>} [probe] - 探测函数，测试可注入
 * @returns {() => void} 路由的 disposer
 */
export function registerStatusRoute(server, config, probe = (options) => probeEngines(config, options)) {
  return server.register({
    kind: 'exact',
    path: STATUS_ROUTE,
    handler: (request, response) => statusHandler(request, response, probe),
  })
}

/**
 * 回答一次 describe 请求。
 * @param {object} request - HTTP 请求
 * @param {object} response - HTTP 响应
 * @param {() => object} describe - 载荷构造函数
 */
export async function describeHandler(request, response, describe = () => describeConfig()) {
  try {
    if (refused(request, response)) return
    if ((request.method ?? 'GET') === 'HEAD') {
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
      response.end()
      return
    }
    sendJson(response, 200, describe())
  } catch {
    // 与 status 同理：页面已经走开时不要再抛进 web server 的请求管线。
    try {
      response.destroy()
    } catch {
      // 已经没了。
    }
  }
}

/**
 * 把 describe 路由注册到 Host 的 web server 上。
 * @param {object} server - 解析出的 `webServer` 服务
 * @param {() => object} [describe] - 载荷构造函数，测试可注入
 * @returns {() => void} 路由的 disposer
 */
export function registerDescribeRoute(server, describe = () => describeConfig()) {
  return server.register({
    kind: 'exact',
    path: DESCRIBE_ROUTE,
    handler: (request, response) => describeHandler(request, response, describe),
  })
}
