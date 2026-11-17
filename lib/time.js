/**
 * 索引时间字段的归一：Windows FILETIME → ISO。
 *
 * 单独成文件是为了切断 `everything.js → format.js → engines.js → everything.js` 这个环。
 */

/**
 * 把 FILETIME（1601 起的 100ns 计数）转成 ISO。
 * @param {unknown} ft - 索引给的时间字段
 * @returns {string|undefined} ISO 时间；0、负数或非法值返回 undefined
 */
export function filetimeToIso(ft) {
  if (typeof ft !== 'number' || ft <= 0) return undefined
  const date = new Date(ft / 10000 - 11644473600000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
