/**
 * Config access shared by activation and every tool call.
 *
 * The fields the Plugins page may edit are declared `.volatile()` in the
 * schema, so the Host hands `apply` a live reference instead of the value
 * frozen at activation. A save on the page updates that reference in place;
 * only `get()` sees it. Nothing downstream may keep such a reference, so every
 * operation starts from {@link readConfig}'s plain snapshot.
 *
 * `timeoutMs` is deliberately not in {@link LIVE_KEYS}: `defineTool` fixes each
 * tool's deadline when the tool is registered, so a new value could not take
 * effect without reloading the row. It stays a profile-YAML setting.
 */

/** Config keys the Plugins page edits. */
export const LIVE_KEYS = [
  'esPath',
  'esEncoding',
  'anytxtUrl',
  'workspaceRoot',
  'workRoot',
  'personalRoot',
  'allRoots',
  'maxResults',
  'readMaxChars',
]

/**
 * Read a value that may still be a live volatile reference.
 * @param {unknown} value - plain value, or a reference carrying `get()`
 * @returns {unknown} the current value
 */
export function liveValue(value) {
  return typeof value?.get === 'function' ? value.get() : value
}

/**
 * Snapshot the whole config as plain values.
 * @param {object} config - schema output, volatile references included
 * @returns {object} plain values for this operation
 */
export function readConfig(config) {
  const snapshot = {}
  for (const key of [...LIVE_KEYS, 'timeoutMs']) snapshot[key] = liveValue(config[key])
  return snapshot
}

function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`dsh-local-search: ${field} must be a positive integer`)
  }
}

/** Hosts that name this machine. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * Whether a value is an `http(s)` URL that names this machine.
 *
 * Both indexes describe the local machine: `es.exe` is spawned here, and every
 * Anytxt result carries a path that only resolves here. A remote endpoint would
 * answer with another machine's paths, so it is refused rather than supported —
 * tunnelling one in lands it on loopback anyway.
 * @param {unknown} value - candidate endpoint
 * @returns {boolean} true for a loopback `http(s)` URL
 */
export function isLoopbackUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value))
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return LOOPBACK_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, ''))
}

/**
 * Validate a candidate config and return its plain snapshot. Run once at
 * activation; the page's writes are validated by the Host against the Config
 * schema before they are persisted, so the range checks that matter live there
 * (`lib/index.js`) and this function covers what the schema cannot express.
 *
 * The endpoint's loopback rule is deliberately *not* enforced here. A profile
 * that 0.1 accepted must still activate: a wrong address should fail the content
 * engine with a readable error, not take file-name search down with it. The
 * rule lives where the endpoint is used (`lib/anytxt.js`).
 * @param {object} config - schema output, volatile references included
 * @param {number} [maxTimerDelayMs] - largest deadline the timer API accepts
 * @returns {object} the validated plain snapshot
 */
export function validateConfig(config, maxTimerDelayMs) {
  const values = readConfig(config)
  assertPositiveInteger('maxResults', values.maxResults)
  assertPositiveInteger('timeoutMs', values.timeoutMs)
  assertPositiveInteger('readMaxChars', values.readMaxChars)
  if (maxTimerDelayMs !== undefined && values.timeoutMs > maxTimerDelayMs) {
    throw new Error(`dsh-local-search: timeoutMs must be no greater than ${maxTimerDelayMs}`)
  }
  return values
}
