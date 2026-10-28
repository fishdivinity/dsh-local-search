import { EngineError } from './errors.js'
import { getEsVersion, resolveEsPath, searchFiles } from './everything.js'
import { anytxtStatus, getFragments, getRawText, searchContent } from './anytxt.js'
import { assertRefEngine, formatRef, parseRef } from './ref.js'

/**
 * Engine registry. A new filename or content backend is one entry here plus
 * its module; the tool surface and `engine` values stay unchanged.
 *
 * files:   { name, search(args), status(args) }
 * content: { name, search(args), fragments(args), read(args), status(args) }
 */
const filesEngines = new Map([
  [
    'everything',
    {
      name: 'everything',
      search: (args) => searchFiles(args),
      status: async (args) => ({
        ok: true,
        version: await getEsVersion(args),
        path: resolveEsPath(args.config ?? {}),
      }),
    },
  ],
])

const contentEngines = new Map([
  [
    'anytxt',
    {
      name: 'anytxt',
      async search(args) {
        const result = await searchContent(args)
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            engine: 'anytxt',
            ref: formatRef('anytxt', item.ref),
          })),
        }
      },
      fragments(args) {
        const parsed = assertRefEngine(parseRef(args.ref), 'anytxt')
        return getFragments({ ...args, ref: parsed.id })
      },
      read(args) {
        const parsed = assertRefEngine(parseRef(args.ref), 'anytxt')
        return getRawText({ ...args, ref: parsed.id })
      },
      status: (args) => anytxtStatus(args),
    },
  ],
])

function resolve(registry, kind, requested) {
  const name = requested || 'auto'
  if (name === 'auto') return registry.values().next().value
  const engine = registry.get(name)
  if (!engine) {
    throw new EngineError(`unknown ${kind} engine: ${name}`, 'ENGINE_UNSUPPORTED', {
      hint: `Use auto, ${[...registry.keys()].join(', ')}.`,
    })
  }
  return engine
}

/** Resolve a filename engine; `auto` selects the first registered engine. */
export function resolveFilesEngine(requested = 'auto') {
  return resolve(filesEngines, 'files', requested)
}

/** Resolve a content engine; `auto` selects the first registered engine. */
export function resolveContentEngine(requested = 'auto') {
  return resolve(contentEngines, 'content', requested)
}

/** Engine names for status output and future config pages. */
export function engineNames() {
  return {
    files: [...filesEngines.keys()],
    content: [...contentEngines.keys()],
  }
}
