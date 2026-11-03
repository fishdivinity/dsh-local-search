/**
 * 语言包读盘：`lib/locales/<lang>.json` → `{ [lang]: { [key]: string } }`。
 *
 * 语言包是可选的只读层，读不到不是故障：目录没有、某个文件坏了、JSON 里不是一棵键值树，就只是
 * 少一门语言，页面照常回落英文。所以这里一律吞掉错误，只交出已经读到的那部分。
 *
 * 只认 `*.json`，文件名（去扩展名）就是语言 id。这里不校验键集合：缺键由壳子回退英文，坏文件
 * 也只该少这一门。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUFFIX = '.json'

/**
 * 读一份语言包集合。
 * @param {URL|string} [directory] - 语言包目录；默认与本模块同级的 `locales/`
 * @returns {{[lang: string]: {[key: string]: string}}} 语言 id → 键值树；语言名按字典序
 */
export function readLocalePacks(directory = new URL('./locales/', import.meta.url)) {
  const root = directory instanceof URL ? fileURLToPath(directory) : String(directory)
  let names
  try {
    names = readdirSync(root)
  } catch {
    // 整个目录读不到：没有语言包，不是故障。
    return {}
  }
  // 先排序再组装：`JSON.stringify` 保留插入顺序，而语言包要发一个按内容算的 ETag。
  const languages = names
    .filter((name) => name.endsWith(SUFFIX))
    .map((name) => name.slice(0, -SUFFIX.length))
    .filter((lang) => lang !== '')
    .sort()
  const packs = {}
  for (const lang of languages) {
    const pack = readPack(join(root, `${lang}${SUFFIX}`))
    if (pack !== undefined) packs[lang] = pack
  }
  return packs
}

/**
 * 读一个语言包文件；读不动、不是 JSON、不是对象都算「没有这一门」。
 * @param {string} location - 文件路径
 * @returns {object|undefined} 键值树，或 undefined
 */
function readPack(location) {
  try {
    const parsed = JSON.parse(readFileSync(location, 'utf8'))
    return isPack(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 语言包必须是一棵键值树：数组、标量、null 都是放错位置的文件。
 * @param {unknown} value - JSON.parse 的结果
 * @returns {boolean} 是对象时为 true
 */
function isPack(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
