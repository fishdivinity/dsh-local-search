import { EngineError } from './errors.js'
import { probe as probeEverything, searchFiles } from './everything.js'
import { getFragments, getRawText, probe as probeAnytxt, searchContent } from './anytxt.js'
import { assertRefEngine, parseRef } from './ref.js'
import { contentResult, filesResult } from './result.js'

/**
 * 引擎注册表。新增一个文件名或内容后端 = 这里一条 + 它自己的模块；工具表面、状态行、诊断文本与
 * `engine` 的取值都从这里派生，不用再去各处点名。
 *
 * files:   { name, search(args), probe(args) }
 * content: { name, search(args), fragments(args), read(args), probe(args) }
 *
 * `search` 的返回值由 `lib/result.js` 盖章：adapter 只交 raw，`ref` / `engine` / `truncated` 在这里统一。
 * `probe` 由后端自己判四态（见 `lib/probe.js` 的表）：注册表不替它猜「缺的是哪一环」。
 */
const filesEngines = new Map([
  [
    'everything',
    {
      name: 'everything',
      async search(args) {
        return filesResult(await searchFiles(args))
      },
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
        return contentResult(await searchContent(args), { engine: 'anytxt' })
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

/**
 * 注册表里的一条。`kind` 必须是字面量：状态行与页面按它分支，宽成 string 就没人再检查。
 * @typedef {{id: string, kind: 'files'|'content'}} EngineEntry
 */

/**
 * 注册表里的后端，按「文件名在前、内容在后」的固定顺序。
 * 状态行、诊断、页面与契约测试都遍历它；顺序稳定，模型的输出就不会因为 Map 顺序变化而抖动。
 * @returns {Array<EngineEntry>} 后端清单
 */
export function engineEntries() {
  return [
    ...[...filesEngines.keys()].map(/** @returns {EngineEntry} */ (id) => ({ id, kind: 'files' })),
    ...[...contentEngines.keys()].map(/** @returns {EngineEntry} */ (id) => ({ id, kind: 'content' })),
  ]
}

/** 状态输出与配置页用的引擎名。 */
export function engineNames() {
  return {
    files: [...filesEngines.keys()],
    content: [...contentEngines.keys()],
  }
}
