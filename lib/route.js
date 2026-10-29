/**
 * The configuration page's Test control needs one thing the browser cannot do
 * itself: call the local Anytxt JSON-RPC and `es.exe` and report whether they
 * answered. A cross-origin POST from the page to `127.0.0.1:9920` is refused by
 * both sides, so the page asks the Host instead.
 *
 * The route is `exact` on the bare `webServer`, the same seam the other
 * installed plugins use (a prefix/exact registration never passes through the
 * shell's `/api` fence). It is read-only and sends no CORS headers, so a foreign
 * page cannot read the answer.
 *
 * A foreign page *can* still fire a plain GET, and a GET here spends an es.exe
 * spawn, so the route refuses any request a browser marks as cross-site
 * (`Sec-Fetch-Site`) or whose `Origin` is not this Host. A non-browser caller
 * sends neither header and is a local process the page's CSRF risk does not
 * cover.
 *
 * `?anytxtUrl=` lets the page test what the user typed before saving. That
 * draft is untrusted input, so it is accepted only as a loopback `http(s)` URL:
 * enough to type `127.0.0.1:9921` and try, never a request-forwarding proxy.
 * Without the parameter the route probes the saved configuration; a saved
 * endpoint that is not local fails in the engine with `ANYTXT_ENDPOINT_REMOTE`.
 */

import { probeEngines } from './probe.js'
import { isLoopbackUrl } from './config.js'

/** Path the page fetches; the page resolves it against its own base URI. */
export const STATUS_ROUTE = '/dsh-local-search/api/status'

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
 * Whether the request came from this page rather than another site.
 * @param {object} request - the HTTP request (only `headers` is read)
 * @returns true for a same-origin request, or one no browser sent
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
 * Read the draft endpoint a pre-save test asks about.
 *
 * It runs the same loopback rule the config schema enforces, so a draft can
 * never reach an address the saved configuration could not hold.
 * @param {string} requestUrl - the request target
 * @returns {{ok: true, value: string|undefined} | {ok: false}} the draft, or why it was refused
 */
export function draftEndpoint(requestUrl) {
  let parsed
  try {
    parsed = new URL(String(requestUrl ?? '/'), 'http://localhost')
  } catch {
    return { ok: true, value: undefined }
  }
  const raw = parsed.searchParams.get('anytxtUrl')
  if (raw === null || raw.trim() === '') return { ok: true, value: undefined }
  const trimmed = raw.trim()
  return isLoopbackUrl(trimmed) ? { ok: true, value: trimmed } : { ok: false }
}

/**
 * Answer one probe request.
 * @param {object} request - the HTTP request (`method` and `url` are read)
 * @param {object} response - the HTTP response
 * @param {(options: object) => Promise<{everything: object, anytxt: object}>} probe - the probe to run
 */
export async function statusHandler(request, response, probe) {
  try {
    await answerStatus(request, response, probe)
  } catch {
    // A page that navigated away mid-probe leaves a dead socket; a rejected
    // promise here would surface as an unhandled rejection in the web server's
    // request pipeline.
    try {
      response.destroy()
    } catch {
      // Already gone.
    }
  }
}

/**
 * Write the answer for one request.
 * @param {object} request - the HTTP request
 * @param {object} response - the HTTP response
 * @param {(options: object) => Promise<{everything: object, anytxt: object}>} probe - the probe to run
 */
async function answerStatus(request, response, probe) {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  // A probe costs an es.exe spawn, so another site's page must not be able to
  // trigger one with an ordinary GET.
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { ok: false, code: 'CROSS_SITE_REFUSED', message: 'this route answers this page only' })
    return
  }
  // HEAD claims reachability without spending an es.exe spawn: a probe is the
  // whole cost of this route, and the body carries the only useful answer.
  if (method === 'HEAD') {
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
    response.end()
    return
  }
  const draft = draftEndpoint(request.url)
  if (!draft.ok) {
    sendJson(response, 400, {
      ok: false,
      code: 'ANYTXT_URL_REJECTED',
      message: 'a draft endpoint must be a loopback http(s) url',
    })
    return
  }
  let payload
  let status = 200
  try {
    // This route only feeds the page, so it may carry the actionable cause the
    // model-facing status keeps out of its surface.
    const probed = await probe({ anytxtUrl: draft.value, detail: true })
    payload = {
      ok: Boolean(probed.everything?.ok) && Boolean(probed.anytxt?.ok),
      checkedAt: Date.now(),
      everything: probed.everything ?? { ok: false, code: 'UNKNOWN' },
      anytxt: probed.anytxt ?? { ok: false, code: 'UNKNOWN' },
    }
  } catch (error) {
    status = 500
    payload = { ok: false, code: 'PROBE_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
  sendJson(response, status, payload)
}

/**
 * Register the probe route on the Host's web server.
 * @param {object} server - the resolved `webServer` service
 * @param {object} config - schema output, volatile references included
 * @param {(options: object) => Promise<object>} [probe] - the probe, injectable for tests
 * @returns {() => void} route disposer
 */
export function registerStatusRoute(server, config, probe = (options) => probeEngines(config, options)) {
  return server.register({
    kind: 'exact',
    path: STATUS_ROUTE,
    handler: (request, response) => statusHandler(request, response, probe),
  })
}
