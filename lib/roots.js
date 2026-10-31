import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { EngineError } from './errors.js'

export const SCOPES = ['workspace', 'work', 'personal', 'all']

/** `all` 的默认根：系统盘，加上存在时的 D:。 */
export function defaultAllRoots() {
  const roots = []
  const systemDrive = process.env.SystemDrive || 'C:'
  const candidates = [systemDrive, 'D:']
  for (const drive of candidates) {
    const root = drive.endsWith('\\') ? drive : `${drive}\\`
    if (!roots.includes(root) && existsSync(root)) roots.push(root)
  }
  return roots
}

/** 解析分号分隔的 `allRoots` 配置。 */
export function parseAllRoots(value) {
  return String(value || '')
    .split(';')
    .map((root) => root.trim())
    .filter(Boolean)
}

/** 校验一个已存在的绝对目录根。 */
export function validateRoot(root, label = 'root') {
  if (!root || typeof root !== 'string' || !isAbsolute(root)) {
    throw new EngineError(`${label} must be an absolute directory: ${root ?? '(empty)'}`, 'ROOT_NOT_ABSOLUTE', {
      hint: `Set ${label} to an existing absolute directory.`,
    })
  }
  if (!existsSync(root)) {
    throw new EngineError(`${label} does not exist: ${root}`, 'ROOT_NOT_FOUND', {
      hint: `Set ${label} to an existing directory.`,
    })
  }
  // 文件也能过 existsSync，但会让 es.exe -path 与 Anytxt 的 filterDir 返回空：读起来像
  // 「没有结果」，而不是配置写错了。
  if (!statSync(root).isDirectory()) {
    throw new EngineError(`${label} is not a directory: ${root}`, 'ROOT_NOT_DIRECTORY', {
      hint: `Set ${label} to a directory, not a file.`,
    })
  }
  return root
}

/**
 * 丢掉嵌套在另一个根里的根。
 *
 * Anytxt 的检索是每个根问一次再把 count 相加，重叠的根会把同一个文件数两遍：「x of y」的
 * 表头虚高，`truncated` 也提前翻真。每棵独立的树只查一次同样更省。
 * @param {string[]} roots - 已校验的绝对目录
 * @returns {string[]} 不在另一个根里的那些根
 */
export function dedupeRoots(roots) {
  // Windows 两种分隔符都认，所以比较时统一成一种写法，返回时仍用调用方自己的写法。
  const normalized = roots.map((root) => root.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase())
  return roots.filter((root, index) => !normalized.some((other, otherIndex) => {
    if (otherIndex === index) return false
    // 同一棵树被写了两遍时只留第一次出现的那个。
    if (normalized[index] === other) return otherIndex < index
    return normalized[index].startsWith(`${other}\\`)
  }))
}

/**
 * 解析一次调用该搜哪些目录。
 *
 * `workspace` 回落到会话的默认目录；`work` 与 `personal` 必须显式配置；`all` 用 `allRoots`
 * 或 C:/D: 的默认值。
 */
export function rootsFor(scope, explicitPath, config, defaultWorkspace) {
  const normalized = scope || 'workspace'
  if (!SCOPES.includes(normalized)) {
    throw new EngineError(`unknown scope: ${scope}`, 'INVALID_SCOPE', {
      hint: `Use one of ${SCOPES.join(', ')}.`,
    })
  }
  if (explicitPath) {
    return [validateRoot(explicitPath, 'path')]
  }
  if (normalized === 'workspace') {
    return [validateRoot(config?.scopes?.workspaceRoot || defaultWorkspace || process.cwd(), 'workspaceRoot')]
  }
  if (normalized === 'work') {
    if (!config?.scopes?.workRoot) {
      throw new EngineError('workRoot is not configured', 'SCOPE_NOT_CONFIGURED', {
        hint: 'Set workRoot in the plugin config, or pass an explicit path.',
      })
    }
    return [validateRoot(config.scopes.workRoot, 'workRoot')]
  }
  if (normalized === 'personal') {
    if (!config?.scopes?.personalRoot) {
      throw new EngineError('personalRoot is not configured', 'SCOPE_NOT_CONFIGURED', {
        hint: 'Set personalRoot in the plugin config, or pass an explicit path.',
      })
    }
    return [validateRoot(config.scopes.personalRoot, 'personalRoot')]
  }
  const configured = parseAllRoots(config?.scopes?.allRoots)
  const roots = (configured.length > 0 ? configured : defaultAllRoots()).filter((root) => existsSync(root))
  if (roots.length === 0) {
    throw new EngineError('no allRoots are available', 'SCOPE_NOT_CONFIGURED', {
      hint: 'Set allRoots to existing directories, or pass an explicit path.',
    })
  }
  return dedupeRoots(roots)
}
