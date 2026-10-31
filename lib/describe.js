/**
 * 配置页的后端描述（`GET /dsh-local-search/api/describe`）。
 *
 * 页面不该知道世界上有 Everything 和 Anytxt：它只知道「有几个能力节、每节可选哪些后端、
 * 选中后端后显示哪些字段」。这些事实由 Host 给，新增后端在 Host 注册表与这里各加一条，
 * 页面逻辑不动；字段的措辞留在客户端字典里，这里只给键名。
 *
 * 能力名（文件名检索 / 文件内容检索）由客户端按语言取词，后端一律用产品名。
 */

import { DEFAULTS, PATHS } from './config.js'
import { engineNames } from './engines.js'
import { MAX_LIMIT, MAX_READ } from './limits.js'

/**
 * 页面那个统一的「重置」要做什么。
 *
 * 它等价于把首用自动配置重跑一遍：清掉引擎与上限、按探测结果把 `esPath` 与 Anytxt 地址填回去、
 * 再盖上「已经做过决定」的标记。`scopes` 不在清空列表里——那是用户手填的机器路径，重置顺手抹掉
 * 的代价太高。`default` 用来判断探到的值是否与默认一致，一致就不必写进 profile。
 */
const RESET = {
  clear: [
    PATHS.esPath,
    PATHS.esEncoding,
    PATHS.anytxtUrl,
    PATHS.filesBackend,
    PATHS.contentBackend,
    PATHS.maxResults,
    PATHS.readMaxChars,
  ],
  fills: [
    { path: PATHS.esPath, from: 'everything.path' },
    { path: PATHS.anytxtUrl, from: 'anytxt.url', default: DEFAULTS.content.anytxt.url },
  ],
  marker: PATHS.autoConfigured,
}

/** 后端的产品名在字典里的键；未收录的新后端直接显示注册表里的名字。 */
const ENGINE_LABEL_KEYS = {
  everything: 'engineEverything',
  anytxt: 'engineAnytxt',
}

/**
 * 每个后端自己的字段表。
 *
 * `path` 取 {@link PATHS}，不写字面量；`aliases` 让页面的二选一控件认旧标签（0.1 写过
 * `utf8`，schema 至今仍接受任意 TextDecoder 标签）。
 *
 * 字段上这几个标记是 Host 与页面之间**唯一的暗号**，由页面据此决定渲染与校验，加字段时别漏：
 * `verifyPath` / `verifyDir` 交给 Host 查存在性（不 spawn），`probeEndpoint` 是测试连接要探的地址，
 * `localUrl` 要求本机 http(s)，`type: 'count'` 带 `max` 上限。
 */
const ENGINE_FIELDS = {
  files: {
    everything: [
      {
        path: PATHS.esPath,
        type: 'text',
        labelKey: 'esPathLabel',
        hintKey: 'esPathHint',
        // 保存前由 Host 只查「这个文件在不在」：跑一条任意路径等于开一个远程执行口。
        verifyPath: true,
      },
      {
        path: PATHS.esEncoding,
        type: 'choice',
        labelKey: 'esEncodingLabel',
        hintKey: 'esEncodingHint',
        choices: [
          { value: 'gbk', labelKey: 'encodingGbk' },
          { value: 'utf-8', labelKey: 'encodingUtf8' },
        ],
        aliases: { utf8: 'utf-8', utf: 'utf-8' },
      },
    ],
  },
  content: {
    anytxt: [
      {
        path: PATHS.anytxtUrl,
        type: 'text',
        labelKey: 'anytxtUrlLabel',
        hintKey: 'anytxtUrlHint',
        localUrl: true,
        probeEndpoint: true,
      },
    ],
  },
}

/** 能力节：标题是能力，节内先选后端。 */
const CAPABILITY_SECTIONS = [
  { id: 'files', group: 'files', titleKey: 'sectionFiles', backendPath: PATHS.filesBackend },
  { id: 'content', group: 'content', titleKey: 'sectionContent', backendPath: PATHS.contentBackend },
]

/** 与后端无关的节，留在页尾。 */
const PLAIN_SECTIONS = [
  {
    id: 'scopes',
    titleKey: 'sectionScopes',
    fields: [
      { path: PATHS.workspaceRoot, type: 'text', labelKey: 'workspaceRootLabel', hintKey: 'workspaceRootHint', verifyDir: true },
      { path: PATHS.workRoot, type: 'text', labelKey: 'workRootLabel', hintKey: 'workRootHint', verifyDir: true },
      { path: PATHS.personalRoot, type: 'text', labelKey: 'personalRootLabel', hintKey: 'personalRootHint', verifyDir: true },
      { path: PATHS.allRoots, type: 'text', labelKey: 'allRootsLabel', hintKey: 'allRootsHint', verifyDir: true },
    ],
  },
  {
    id: 'limits',
    titleKey: 'sectionLimits',
    fields: [
      { path: PATHS.maxResults, type: 'count', max: MAX_LIMIT, labelKey: 'maxResultsLabel', hintKey: 'maxResultsHint' },
      { path: PATHS.readMaxChars, type: 'count', max: MAX_READ, labelKey: 'readMaxCharsLabel', hintKey: 'readMaxCharsHint' },
    ],
  },
]

/** 一个能力的后端列表，只列真正注册过的引擎。 */
function backendsOf(group) {
  return engineNames()[group].map((name) => {
    const labelKey = ENGINE_LABEL_KEYS[name]
    return labelKey === undefined ? { name } : { name, labelKey }
  })
}

/** 一个能力的字段列表，标上它属于哪个后端。 */
function fieldsOf(group) {
  const fields = ENGINE_FIELDS[group] ?? {}
  return engineNames()[group].flatMap((name) => (fields[name] ?? []).map((field) => ({ ...field, backend: name })))
}

/**
 * 组装页面要渲染的结构。
 * @param {object} [autoconfig] - 首用自动配置的进展，供页面决定是否提示引擎不可用
 * @param {boolean} [autoconfig.ran] - 本次启动是否真的探测并写过配置
 * @param {boolean} [autoconfig.pending] - 探测还没结束
 * @param {Array<{engine: string, code: string}>} [autoconfig.failures] - 不可用的引擎
 * @returns {object} describe 载荷
 */
export function describeConfig(autoconfig) {
  const sections = [
    ...CAPABILITY_SECTIONS.map(({ id, group, titleKey, backendPath }) => ({
      id,
      titleKey,
      backendPath,
      backends: backendsOf(group),
      fields: fieldsOf(group),
    })),
    ...PLAIN_SECTIONS.map(({ id, titleKey, fields }) => ({ id, titleKey, fields })),
  ]
  const payload = { sections, reset: RESET }
  if (autoconfig !== undefined) payload.autoconfig = autoconfig
  return payload
}
