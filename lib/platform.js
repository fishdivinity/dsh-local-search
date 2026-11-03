/**
 * 平台识别：这台机器是什么平台、路径怎么写、`~` 与默认根在哪。
 *
 * 所有「按平台分叉」的默认值只从这里出——别的模块不再读 `process.platform`，也不再读
 * `process.env.SystemDrive`。参数化（`detect('darwin')`）只为测试：真机不传参；平台参数与
 * 真机不一致时 `home` 与默认根只按注入的 `io` 算，不读真机，免得在 Windows 上「探测」出
 * 一个 macOS 的家目录。
 *
 * 这里只做路径语义与盘符探测，不碰网络、不 spawn：三个平台的行为要能被同一组单测钉住。
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'

/** `process.platform` 里真的适配过的三个；其余按 POSIX 处理，而不是装作认识它。 */
const KNOWN = new Set(['win32', 'darwin', 'linux'])

/** 盘符路径 / UNC 路径。只重写这两种写法，POSIX 与相对路径原样留着。 */
const DRIVE_PATH = /^[a-z]:[\\/]/i
const UNC_PATH = /^[\\/]{2}/

/**
 * 这台机器的平台事实。
 *
 * `caseInsensitive` 只影响比较与去重，不改写原值：Windows 与默认 APFS 不区分大小写，
 * Ext4 区分。
 * @param {string} [platform] - `process.platform` 的一个值，测试可传 `darwin` / `linux`
 * @param {object} [io] - 测试注入：`exists` / `readdir` / `home`
 * @returns {{os: string, pathStyle: 'windows'|'posix', caseInsensitive: boolean, home: string, defaultAllRoots: string[]}}
 */
export function detect(platform = process.platform, io = {}) {
  const os = KNOWN.has(platform) ? platform : 'linux'
  const facts = { ...defaultIo(platform), ...io }
  return {
    os,
    pathStyle: os === 'win32' ? 'windows' : 'posix',
    caseInsensitive: os !== 'linux',
    home: facts.home,
    defaultAllRoots: defaultAllRoots(os, facts),
  }
}

/** 真机上的 io；注入时只覆盖传进来的那几项。 */
function defaultIo(platform) {
  return {
    exists: existsSync,
    readdir: (directory) => {
      try {
        return readdirSync(directory)
      } catch {
        // 卷目录不存在或没有权限：这个平台的默认根就是空表，不是故障。
        return []
      }
    },
    // 只在问的是本机时读真家目录；模拟别的平台时留空，免得把真路径混进测试。
    home: platform === process.platform ? homedir() : '',
  }
}

/**
 * 每个平台的默认检索根。
 *
 * Windows 扫 A:–Z:，只留存在的盘根——盘符会变，不写死系统盘与 `D:`；26 次 `existsSync`
 * 约 1 ms，比 spawn 便宜。macOS 取 `/Users` 与 `/Volumes` 下的卷，Linux 取 `/home`；
 * 不存在的候选直接丢掉。
 * @param {string} os - 已归一化的平台名
 * @param {object} io - 见 {@link defaultIo}
 * @returns {string[]} 存在的默认根
 */
function defaultAllRoots(os, io) {
  if (os === 'win32') {
    const roots = []
    for (let code = 65; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`
      if (io.exists(root)) roots.push(root)
    }
    return roots
  }
  if (os === 'darwin') {
    const roots = []
    if (io.exists('/Users')) roots.push('/Users')
    for (const volume of io.readdir('/Volumes')) {
      const root = `/Volumes/${volume}`
      if (!roots.includes(root) && io.exists(root)) roots.push(root)
    }
    return roots
  }
  return io.exists('/home') ? ['/home'] : []
}

/**
 * 路径风格。接受平台名或 {@link detect} 的结果——页面从 describe 拿到的是后者。
 * @param {string|object} [platform] - 平台名或 detect 结果
 * @returns {'windows'|'posix'}
 */
export function pathStyleOf(platform = process.platform) {
  if (typeof platform === 'string') return platform === 'win32' ? 'windows' : 'posix'
  return platform?.pathStyle === 'posix' ? 'posix' : 'windows'
}

function homeOf(platform) {
  if (typeof platform === 'string') return platform === process.platform ? homedir() : ''
  return typeof platform?.home === 'string' ? platform.home : ''
}

function separatorOf(style) {
  return style === 'windows' ? '\\' : '/'
}

/**
 * `~/x` / `~\x` 展开成家目录下。
 *
 * `~user` 不是我们的写法，原样返回；家目录取不到时也原样返回——展开不了就别改，交给存在性
 * 校验去报「不存在」。
 * @param {string} text - 用户写的路径
 * @param {string|object} [platform] - 平台名或 detect 结果
 * @returns {string} 展开后的路径
 */
export function expandHome(text, platform = process.platform) {
  const value = String(text ?? '').trim()
  if (!value.startsWith('~')) return value
  const home = homeOf(platform)
  if (home === '') return value
  if (value === '~') return home
  const next = value[1]
  if (next !== '/' && next !== '\\') return value
  const style = pathStyleOf(platform)
  const rest = value.slice(2).replace(/^[\\/]+/, '')
  if (rest === '') return home
  const tail = style === 'windows' ? rest.replace(/[\\/]+/g, '\\') : rest
  return `${home.replace(/[\\/]+$/, '')}${separatorOf(style)}${tail}`
}

/**
 * 把一个路径草稿改写成标准写法：盘符大写、只用 `\`、去掉多余与末尾的分隔符。
 *
 * 只在 Windows 风格上改写：POSIX 与相对路径原样留着（`/home/me` 在 Windows 上换个分隔符
 * 也还是不存在），`~` 也不动——展开是使用点的事（{@link expandHome}）。
 * @param {string} text - 输入框里的路径
 * @param {string|object} [platform] - 平台名或 detect 结果
 * @returns {string} 标准写法；空串仍是空串
 */
export function normalizePath(text, platform = process.platform) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return ''
  if (pathStyleOf(platform) !== 'windows') return trimmed
  if (!DRIVE_PATH.test(trimmed) && !UNC_PATH.test(trimmed)) return trimmed
  const unc = UNC_PATH.test(trimmed)
  let value = trimmed.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  // 折叠分隔符会把 UNC 开头的两个也压成一个，这里补回来。
  if (unc) value = `\\${value}`
  if (/^[a-z]:/.test(value)) value = `${value[0].toUpperCase()}${value.slice(1)}`
  // 目录末尾的分隔符没有信息量；盘符根 `D:\` 只有三个字符，留着。
  if (value.length > 3 && value.endsWith('\\')) value = value.replace(/\\+$/, '')
  return value
}

/**
 * 分号列表的同一个改写；空项丢掉（它们本来就会被存在性校验跳过）。
 * @param {string} text - 分号分隔的目录列表
 * @param {string|object} [platform] - 平台名或 detect 结果
 * @returns {string} 标准写法，分号分隔
 */
export function normalizePaths(text, platform = process.platform) {
  return String(text ?? '')
    .split(';')
    .map((value) => normalizePath(value, platform))
    .filter((value) => value !== '')
    .join(';')
}

/**
 * 路径是不是绝对路径——按目标平台的写法判，而不是按 `node:path` 那套跟着真机走的规则。
 *
 * Windows 上也接受 `/Users/x` 这种 POSIX 写法（存在就认）：同一份 profile 可能被带到另一台
 * 机器上。相对路径在这里就拒绝，`ROOT_NOT_ABSOLUTE` 仍是它唯一的去处。
 * @param {string} text - 用户写的路径
 * @param {string|object} [platform] - 平台名或 detect 结果
 * @returns {boolean} 绝对路径（或 `~` 开头）时为 true
 */
export function isAbsolutePath(text, platform = process.platform) {
  const value = String(text ?? '').trim()
  if (value === '') return false
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) return true
  if (pathStyleOf(platform) === 'windows') {
    return DRIVE_PATH.test(value) || UNC_PATH.test(value) || /^[\\/]/.test(value)
  }
  return value.startsWith('/')
}
