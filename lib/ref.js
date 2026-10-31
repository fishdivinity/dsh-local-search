import { EngineError } from './errors.js'

/**
 * ref 自带引擎名：`<engine>:<id>`。模型把过期的 ref 递回 local_search_read /
 * local_search_fragments 时，Recoll 的 docid、Everything 的 fid 与将来的 Windows Search
 * 条目才不会撞在一起。
 */
export function formatRef(engine, id) {
  if (!engine || typeof engine !== 'string') {
    throw new EngineError('engine name is required to format a ref', 'INVALID_REF')
  }
  if (id === undefined || id === null || String(id).length === 0) {
    throw new EngineError('ref id is required', 'INVALID_REF')
  }
  return `${engine}:${String(id)}`
}

/** 解析 `<engine>:<id>`；裸 id 直接拒掉，并给一条能照着做的提示。 */
export function parseRef(ref) {
  const text = String(ref ?? '')
  const separator = text.indexOf(':')
  if (separator <= 0 || separator === text.length - 1) {
    throw new EngineError(`ref must look like "<engine>:<id>", got "${text}"`, 'INVALID_REF', {
      hint: 'Rerun local_search_content and pass the item ref unchanged.',
    })
  }
  return { engine: text.slice(0, separator), id: text.slice(separator + 1) }
}

/** 确认 ref 属于已经解析出来的引擎。 */
export function assertRefEngine(parsed, engineName) {
  if (parsed.engine !== engineName) {
    throw new EngineError(`ref belongs to ${parsed.engine}, not ${engineName}`, 'INVALID_REF', {
      hint: 'Pass the item ref and its engine together, unchanged.',
    })
  }
  return parsed
}
