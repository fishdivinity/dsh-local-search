import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { EngineError } from './errors.js'

export const SCOPES = ['workspace', 'work', 'personal', 'all']

/** Default `all` roots: the system drive plus D: when present. */
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

/** Parse the semicolon-separated `allRoots` config. */
export function parseAllRoots(value) {
  return String(value || '')
    .split(';')
    .map((root) => root.trim())
    .filter(Boolean)
}

/** Validate one existing absolute directory root. */
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
  // A file passes existsSync but makes es.exe -path and Anytxt filterDir return
  // nothing, which reads as "no results" instead of a configuration mistake.
  if (!statSync(root).isDirectory()) {
    throw new EngineError(`${label} is not a directory: ${root}`, 'ROOT_NOT_DIRECTORY', {
      hint: `Set ${label} to a directory, not a file.`,
    })
  }
  return root
}

/**
 * Resolve the directories a call should search.
 *
 * `workspace` falls back to the session's default directory; `work` and
 * `personal` require explicit config; `all` uses `allRoots` or the C:/D:
 * defaults.
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
    return [validateRoot(config.workspaceRoot || defaultWorkspace || process.cwd(), 'workspaceRoot')]
  }
  if (normalized === 'work') {
    if (!config.workRoot) {
      throw new EngineError('workRoot is not configured', 'SCOPE_NOT_CONFIGURED', {
        hint: 'Set workRoot in the plugin config, or pass an explicit path.',
      })
    }
    return [validateRoot(config.workRoot, 'workRoot')]
  }
  if (normalized === 'personal') {
    if (!config.personalRoot) {
      throw new EngineError('personalRoot is not configured', 'SCOPE_NOT_CONFIGURED', {
        hint: 'Set personalRoot in the plugin config, or pass an explicit path.',
      })
    }
    return [validateRoot(config.personalRoot, 'personalRoot')]
  }
  const configured = parseAllRoots(config.allRoots)
  const roots = (configured.length > 0 ? configured : defaultAllRoots()).filter((root) => existsSync(root))
  if (roots.length === 0) {
    throw new EngineError('no allRoots are available', 'SCOPE_NOT_CONFIGURED', {
      hint: 'Set allRoots to existing directories, or pass an explicit path.',
    })
  }
  return roots
}
