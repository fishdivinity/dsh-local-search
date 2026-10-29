/**
 * The hard caps one call may ask for.
 *
 * The schema caps the saved default, the tools clamp a per-call argument, and
 * the configuration page mirrors the same numbers so a save cannot be rejected.
 * They live here to stay one value; the page cannot import this file (a classic
 * script has no ESM imports), so its copy is checked by a test instead.
 */

/** Hard cap on a result count. */
export const MAX_LIMIT = 100

/** Hard cap on characters one read returns. */
export const MAX_READ = 20000
