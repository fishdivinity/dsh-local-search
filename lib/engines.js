import { EngineError } from './errors.js'
import { probe as probeEverything, searchFiles } from './everything.js'
import { getFragments, getRawText, probe as probeAnytxt, searchContent } from './anytxt.js'
import { assertRefEngine, formatRef, parseRef } from './ref.js'

/**
 * 引擎注册表。新增一个文件名或内容后端 = 这里一条 + 它自己的模块；工具表面与 `engine` 的取值
 * 都不用动。
 *
 * files:   { name, search(args), probe(args) }
 * content: { name, search(args), fragments(args), read(args), probe(args) }
 *
 * `probe` 由后端自己判四态（见 `lib/probe.js` 的表）：注册表不替它猜「缺的是哪一环」。
 */
const filesEngines = new Map([
  [
    'everything',
    {
      name: 'everything',
      search: searchFiles,
      probe: probeEverything,
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
      probe: probeAnytxt,
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

/** 解析文件名引擎；`auto` 取注册表里的第一个。 */
export function resolveFilesEngine(requested = 'auto') {
  return resolve(filesEngines, 'files', requested)
}

/** 解析内容引擎；`auto` 取注册表里的第一个。 */
export function resolveContentEngine(requested = 'auto') {
  return resolve(contentEngines, 'content', requested)
}

/** 状态输出与配置页用的引擎名。 */
export function engineNames() {
  return {
    files: [...filesEngines.keys()],
    content: [...contentEngines.keys()],
  }
}
