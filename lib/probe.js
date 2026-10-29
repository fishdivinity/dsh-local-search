/**
 * One probe of both local indexes, shared by the model-facing
 * `local_search_status` tool and the configuration page's Test control.
 *
 * They answer the same question — "can this machine reach its indexes right
 * now?" — so they must not drift into two slightly different probes. The
 * probe goes through the engine registry, so a new backend is still one entry
 * in `lib/engines.js`.
 */

import { readConfig } from './config.js'
import { resolveContentEngine, resolveFilesEngine } from './engines.js'
import { everythingInstalled } from './everything.js'

/**
 * Which link of the Everything chain is missing.
 *
 * This detail is for the person reading the configuration page, who can install
 * or start something; the model keeps the two stable codes. When the install
 * check itself could not run, the answer is `unknown` and the page falls back to
 * its generic hint rather than telling someone to install what they already have.
 * @param {string} code - the error code the probe produced
 * @returns {'not-installed'|'not-running'|'es-missing'|'unknown'} the actionable cause
 */
export function diagnoseEverything(code, presence = everythingInstalled()) {
  if (!presence.known) return 'unknown'
  if (!presence.installed) return 'not-installed'
  return code === 'EVERYTHING_ES_NOT_FOUND' ? 'es-missing' : 'not-running'
}

/**
 * Probe the configured indexes once, never throwing.
 * @param {object} config - schema output, volatile references included
 * @param {object} [options]
 * @param {string} [options.only] - `auto` probes both; `anytxt` / `everything` skips the other
 * @param {string} [options.workspace] - root Anytxt is asked about
 * @param {string} [options.anytxtUrl] - endpoint to probe instead of the saved one (a page draft)
 * @param {boolean} [options.detail] - add the page-facing cause to a failed engine
 * @param {AbortSignal} [options.signal] - caller cancellation
 * @returns {Promise<{everything: object, anytxt: object}>} both statuses
 */
export async function probeEngines(config, { only = 'auto', workspace, anytxtUrl, signal, detail = false } = {}) {
  const cfg = readConfig(config)
  const everything = { ok: false }
  const anytxt = { ok: false }
  const budget = Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : 5000
  // A probe is a diagnostic, not a search: it gets a floor as well as a ceiling,
  // because a tiny timeoutMs would report a healthy engine as DOWN.
  const probeBudget = Math.max(1500, Math.min(budget, 5000))

  if (only !== 'anytxt') {
    try {
      Object.assign(everything, await resolveFilesEngine('everything').status({
        config: cfg,
        esPath: cfg.esPath,
        timeoutMs: probeBudget,
        signal,
        encoding: cfg.esEncoding,
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
        url: anytxtUrl || cfg.anytxtUrl,
        root: workspace || cfg.workspaceRoot || process.cwd(),
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
