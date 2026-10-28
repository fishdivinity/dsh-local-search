/**
 * Engine-level error with a stable code. Kept independent of the DSH runtime
 * so engine modules and their unit tests can run under plain Node; the tool
 * layer converts these to `HarnessError` before returning to the model.
 */
export class EngineError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {{ cause?: unknown, hint?: string }} [options]
   */
  constructor(message, code, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'EngineError'
    this.code = code
    this.hint = options.hint
  }
}
