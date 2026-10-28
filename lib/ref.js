import { EngineError } from './errors.js'

/**
 * Refs are self-describing: `<engine>:<id>`. This keeps a Recoll docid, an
 * Everything fid, and a future Windows Search item from colliding when the
 * model passes a stale ref back to local_search_read/local_search_fragments.
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

/** Parse `<engine>:<id>`; reject bare ids with an actionable hint. */
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

/** Ensure a ref belongs to the resolved engine. */
export function assertRefEngine(parsed, engineName) {
  if (parsed.engine !== engineName) {
    throw new EngineError(`ref belongs to ${parsed.engine}, not ${engineName}`, 'INVALID_REF', {
      hint: 'Pass the item ref and its engine together, unchanged.',
    })
  }
  return parsed
}
