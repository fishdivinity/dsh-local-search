/**
 * 探测结果的共同读法：「这次算不算后端坏了」。
 */

/**
 * 这次探测结果是否算故障：跳过是根本没探，取消是被中止，两者都不是索引故障。
 * @param {object} [status] - `probe()` / `toStatus()` 的返回
 * @returns {boolean} 需要当故障报告时为 true
 */
export function isFailure(status) {
  if (status === null || status === undefined || status.ok) return false
  const code = String(status.code ?? '')
  return code !== 'SKIPPED' && !code.endsWith('_ABORTED')
}
