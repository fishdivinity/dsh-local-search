/**
 * 带稳定 code 的引擎层错误。刻意不依赖 DSH runtime，引擎模块与它们的单测才能裸跑在普通 Node
 * 上；把它们转成 `HarnessError` 是工具层在返回模型之前做的事。
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
