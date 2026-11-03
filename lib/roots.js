import { existsSync, statSync } from 'node:fs'
import { EngineError } from './errors.js'
import { detect, expandHome, isAbsolutePath, pathStyleOf } from './platform.js'

export const SCOPES = ['workspace', 'work', 'personal', 'all']

/**
 * `all` 的默认根：每个平台各自的系统目录，来自 {@link detect}。
 * @param {object|string} [platform] - detect 的结果或平台名，测试可注入
 * @returns {string[]} 存在的默认根
 */
export function defaultAllRoots(platform = detect()) {
  return typeof platform === 'string' ? detect(platform).defaultAllRoots : platform.defaultAllRoots
}

/** 解析分号分隔的 `allRoots` 配置。 */
export function parseAllRoots(value) {
  return String(value || '')
    .split(';')
    .map((root) => root.trim())
    .filter(Boolean)
}

/**
 * 校验一个已存在的绝对目录根。
 *
 * 返回**展开后**的路径：后端永远不该收到 `~`；保存时由页面把解析后的绝对路径写回。
 * @param {string} root - 用户写的路径
 * @param {string} [label] - 配置里的字段名，报错时点名
 * @param {object|string} [platform] - detect 的结果或平台名
 * @returns {string} 展开后的绝对目录
 */
export function validateRoot(root, label = 'root', platform = detect()) {
  const target = expandHome(root, platform)
  if (!target || typeof target !== 'string' || !isAbsolutePath(target, platform)) {
    throw new EngineError(`${label} must be an absolute directory: ${root ?? '(empty)'}`, 'ROOT_NOT_ABSOLUTE', {
      hint: `Set ${label} to an existing absolute directory.`,
    })
  }
  if (!existsSync(target)) {
    throw new EngineError(`${label} does not exist: ${root}`, 'ROOT_NOT_FOUND', {
      hint: `Set ${label} to an existing directory.`,
    })
  }
  // 文件也能过 existsSync，但会让 es.exe -path 与 Anytxt 的 filterDir 返回空：读起来像
  // 「没有结果」，而不是配置写错了。
  if (!statSync(target).isDirectory()) {
    throw new EngineError(`${label} is not a directory: ${root}`, 'ROOT_NOT_DIRECTORY', {
      hint: `Set ${label} to a directory, not a file.`,
    })
  }
  return target
}

/**
 * 丢掉嵌套在另一个根里的根。
 *
 * Anytxt 每个根问一次再把 count 相加，重叠的根会把同一个文件数两遍：「x of y」虚高、
 * `truncated` 提前翻真。比较规则按平台走：Windows 两种分隔符都认、大小写不敏感；POSIX 大小写
 * 敏感（默认 APFS 除外）。返回时仍是调用方自己的写法。
 * @param {string[]} roots - 已校验的绝对目录
 * @param {object|string} [platform] - detect 的结果或平台名
 * @returns {string[]} 不在另一个根里的那些根
 */
export function dedupeRoots(roots, platform = detect()) {
  const style = pathStyleOf(platform)
  const separator = style === 'windows' ? '\\' : '/'
  const foldCase = typeof platform === 'string' ? style === 'windows' : platform.caseInsensitive === true
  const keyOf = (root) => {
    let value = String(root).replace(/[\\/]+$/, '')
    if (style === 'windows') value = value.replace(/\//g, '\\')
    return foldCase ? value.toLowerCase() : value
  }
  const keys = roots.map(keyOf)
  return roots.filter((root, index) => !keys.some((other, otherIndex) => {
    if (otherIndex === index) return false
    // 同一棵树被写了两遍时只留第一次出现的那个。
    if (keys[index] === other) return otherIndex < index
    return keys[index].startsWith(`${other}${separator}`)
  }))
}

/**
 * 解析一次调用该搜哪些目录：`workspace` 回落到会话目录，`work` / `personal` 必须显式配置，
 * `all` 用 `allRoots` 或该平台的默认根。
 * @param {string} scope - 四个 scope 之一
 * @param {string} [explicitPath] - 调用参数里的 path，给了就盖过 scope
 * @param {object} config - `readConfig` 的快照
 * @param {string} [defaultWorkspace] - 会话工作目录
 * @param {object|string} [platform] - detect 的结果或平台名
 * @returns {string[]} 这次要搜的目录
 */
export function rootsFor(scope, explicitPath, config, defaultWorkspace, platform = detect()) {
  const normalized = scope || 'workspace'
  if (!SCOPES.includes(normalized)) {
    throw new EngineError(`unknown scope: ${scope}`, 'INVALID_SCOPE', {
      hint: `Use one of ${SCOPES.join(', ')}.`,
    })
  }
  if (explicitPath) {
    return [validateRoot(explicitPath, 'path', platform)]
  }
  if (normalized === 'workspace') {
    return [validateRoot(config?.scopes?.workspaceRoot || defaultWorkspace || process.cwd(), 'workspaceRoot', platform)]
  }
  if (normalized === 'work') {
    if (!config?.scopes?.workRoot) {
      throw new EngineError('workRoot is not configured', 'SCOPE_NOT_CONFIGURED', {
        hint: 'Set workRoot in the plugin config, or pass an explicit path.',
      })
    }
    return [validateRoot(config.scopes.workRoot, 'workRoot', platform)]
  }
  if (normalized === 'personal') {
    if (!config?.scopes?.personalRoot) {
      throw new EngineError('personalRoot is not configured', 'SCOPE_NOT_CONFIGURED', {
        hint: 'Set personalRoot in the plugin config, or pass an explicit path.',
      })
    }
    return [validateRoot(config.scopes.personalRoot, 'personalRoot', platform)]
  }
  return allRootsFor(config, defaultWorkspace, platform).roots
}

/**
 * scope=all 的根，带「配置的根全不可用」的兜底。
 *
 * 配置为空就按平台默认根来（用户没设，就不算不一致）；配置了根但一个都不存在时退回 workspace，
 * 由调用方把这件事写进结果——悄悄把整机检索变成单目录检索比失败更误导。
 * @param {object} config - `readConfig` 的快照
 * @param {string} [defaultWorkspace] - 会话工作目录
 * @param {object|string} [platform] - detect 的结果或平台名
 * @returns {{roots: string[], fellBack: boolean, missing: string[]}} 根、是否退回 workspace、缺失的配置根
 */
export function allRootsFor(config, defaultWorkspace, platform = detect()) {
  const configured = parseAllRoots(config?.scopes?.allRoots)
  const candidates = configured.length > 0 ? configured : defaultAllRoots(platform)
  const roots = candidates
    .map((root) => expandHome(root, platform))
    .filter((root) => existsSync(root))
  // 只有用户配置过的根「不在」才算缺失；平台默认根本来就可能少一个，不是用户写错。
  const missing = configured.filter((root) => !existsSync(expandHome(root, platform)))
  if (roots.length > 0) return { roots: dedupeRoots(roots, platform), fellBack: false, missing }
  // 走到这里就是「all 一个根都没有」：不管配置为空还是配置的根都不在，都是悄悄降级，
  // 都要让结果里说出来。
  return {
    roots: rootsFor('workspace', undefined, config, defaultWorkspace, platform),
    fellBack: true,
    missing,
  }
}
