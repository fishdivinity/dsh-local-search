/**
 * 配置页的后端描述（`GET /dsh-local-search/api/describe`）。
 *
 * 页面不该知道世界上有 Everything 和 Anytxt：它只知道「有几个能力节、每节可选哪些后端、
 * 选中后端后显示哪些字段」。这些事实由 Host 给，新增后端在 Host 注册表与这里各加一条，
 * 页面逻辑不动；字段的措辞留在客户端字典里，这里只给键名。
 *
 * 键名一律点号分段（`field.esPath.label`、`section.files`）：语言包是一棵扁平的 `{键: 值}`，
 * 加一种语言就是复制一棵键集合，不需要知道页面怎么排版。
 */

import { DEFAULTS, PATHS } from './config.js'
import { engineNames } from './engines.js'
import { FIELD_META } from './fields.js'
import { detect } from './platform.js'

/**
 * 页面渲染一个字段需要的全部事实。
 *
 * @typedef {object} DescribeField
 * @property {string[]} path - 配置里的嵌套路径，`staged` 与 `settings.mutate` 都用它
 * @property {'text'|'choice'|'count'|'flag'} type
 * @property {string} labelKey - 字典键 `field.<字段名>.label`
 * @property {string} hintKey - 字典键 `field.<字段名>.hint`
 * @property {string} [backend] - 能力节里的字段属于哪个后端
 * @property {boolean} [verifyPath] - 保存前由 Host 查「这个文件在不在」
 * @property {boolean} [verifyDir] - 保存前由 Host 查「这个目录在不在」
 * @property {boolean} [localUrl] - 值必须是本机 http(s) 地址
 * @property {boolean} [probeEndpoint] - 测试连接要探的字段
 * @property {number} [max] - `count` 的硬上限，与 schema 同源
 * @property {Array<{value: string, labelKey: string}>} [choices]
 * @property {Record<string, string>} [aliases] - 旧值到 choice 值的映射
 */

/**
 * `GET /api/describe` 的载荷。
 *
 * @typedef {object} DescribePayload
 * @property {Array<object>} sections - 能力节（带 backends）与页尾的普通节
 * @property {{clear: string[][], fills: Array<object>, marker: string[]}} reset - 页面「重置」的配方
 * @property {{os: string, pathStyle: 'windows'|'posix'}} platform - 页面据此选路径改写规则
 * @property {{pending: boolean, ran: boolean, deferred?: boolean, error?: string}} [autoconfig] - 首用写值的进展；
 *   `deferred` 表示那次写入被挂载时机挡住、留给页面请求补写，不是失败。
 * @property {{pending: boolean, failures: Array<{engine: string, state?: string, detail?: string, code: string}>, checkedAt?: string, disabled: boolean}} [health] - 每次启动的健康检查
 */

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

/**
 * 字段的文案键：默认取配置路径的末段（`esPath`、`maxResults`、`checkEnginesOnStart`），
 * 与 `lib/config.js` 的 {@link PATHS} 键一一对应，不用另写一张表。
 *
 * `anytxtUrl` 是唯一要显式给名字的：它在配置里的末段是泛泛的 `url`，拿它当键名，译者看不出
 * 这是哪个后端的地址。
 * @param {{path: string[], name?: string}} field - 字段描述
 * @returns {{labelKey: string, hintKey: string}} 字典里的两个键
 */
function fieldKeys(field) {
  const name = field.name ?? field.path.at(-1)
  return { labelKey: `field.${name}.label`, hintKey: `field.${name}.hint` }
}

/**
 * 每个后端自己的字段表。
 *
 * `path` 取 {@link PATHS}，不写字面量；`aliases` 让页面的二选一控件认旧的标签写法（schema 仍
 * 接受任意 TextDecoder 标签）。
 *
 * 字段上这几个标记是 Host 与页面之间**唯一的暗号**，由页面据此决定渲染与校验，加字段时别漏：
 * `verifyPath` / `verifyDir` 交给 Host 查存在性（不 spawn），`probeEndpoint` 是测试连接要探的地址，
 * `localUrl` 要求本机 http(s)；`type` / `max` 不写在这儿，从 `lib/fields.js` 的 {@link FIELD_META} 取。
 */
const ENGINE_FIELDS = {
  files: {
    everything: [
      {
        path: PATHS.esPath,
        // 保存前由 Host 只查「这个文件在不在」：跑一条任意路径等于开一个远程执行口。
        verifyPath: true,
      },
      {
        path: PATHS.esEncoding,
        choices: [
          { value: 'gbk' },
          { value: 'utf-8' },
        ],
        aliases: { utf8: 'utf-8', utf: 'utf-8' },
      },
    ],
  },
  content: {
    anytxt: [
      {
        path: PATHS.anytxtUrl,
        name: 'anytxtUrl',
        localUrl: true,
        probeEndpoint: true,
      },
    ],
  },
}

/** 能力节：标题是能力，节内先选后端。 */
const CAPABILITY_SECTIONS = [
  { id: 'files', group: 'files', titleKey: 'section.files', backendPath: PATHS.filesBackend },
  { id: 'content', group: 'content', titleKey: 'section.content', backendPath: PATHS.contentBackend },
]

/** 与后端无关的节，留在页尾。 */
const PLAIN_SECTIONS = [
  {
    id: 'scopes',
    titleKey: 'section.scopes',
    fields: [
      { path: PATHS.defaultScope, full: true },
      { path: PATHS.workspaceRoot, verifyDir: true },
      { path: PATHS.workRoot, verifyDir: true },
      { path: PATHS.personalRoot, verifyDir: true },
      { path: PATHS.allRoots, verifyDir: true },
    ],
  },
  {
    id: 'limits',
    titleKey: 'section.limits',
    fields: [
      { path: PATHS.maxResults },
      { path: PATHS.readMaxChars },
    ],
  },
  {
    id: 'startup',
    titleKey: 'section.startup',
    fields: [
      // 开关管的是「查」，不是「提醒」，所以名字说检查。控件类型从 `lib/fields.js` 取。
      { path: PATHS.checkEnginesOnStart },
    ],
  },
]

/** 一个能力的后端列表，只列真正注册过的引擎。 */
function backendsOf(group) {
  return engineNames()[group].map((name) => ({ name, labelKey: `engine.${name}` }))
}

/** 页面需要的控件类型与上限：同一张字段表，`lib/fields.js` 是唯一来源。 */
function metaOf(field) {
  return FIELD_META.get(field.path.join('.')) ?? { type: 'text' }
}

/**
 * 给字段带上文案键、控件元信息与 choice 的键。
 *
 * 两种 choices 来源都要认：能力节的字段写在 `ENGINE_FIELDS` 上，普通字段来自 `FIELD_META`。
 * choice 的键前缀与 `fieldKeys` 用同一条 `name ?? path.at(-1)` 规则，免得两者指向不同前缀。
 * @param {object} field - 字段描述
 * @returns {object} 页面用的字段
 */
function decorate(field) {
  const meta = metaOf(field)
  const choices = (field.choices ?? meta.choices)?.map((choice) => ({
    ...choice,
    labelKey: `field.${field.name ?? field.path.at(-1)}.choice.${choice.value}`,
  }))
  return {
    ...field,
    ...fieldKeys(field),
    ...meta,
    ...(choices === undefined ? {} : { choices }),
  }
}

/** 一个能力的字段列表，标上它属于哪个后端，并带上文案键。 */
function fieldsOf(group) {
  const fields = ENGINE_FIELDS[group] ?? {}
  return engineNames()[group].flatMap((name) => (fields[name] ?? []).map((field) => ({
    ...decorate(field),
    backend: name,
  })))
}

/** 与后端无关的字段同样带上文案键；choice 的每个候选也要有键。 */
function plainFieldsOf(fields) {
  return fields.map(decorate)
}

/**
 * 组装页面要渲染的结构。
 *
 * 三块可选状态各归各的：`autoconfig` 是首用写值，`health` 是启动健康检查，`platform` 决定页面
 * 的路径改写；都不写行为，只喂页面。
 * @param {object} [state] - autoconfig / health / platform（见 {@link DescribePayload}）
 * @returns {DescribePayload} describe 载荷
 */
export function describeConfig({ autoconfig, health, platform = detect() } = {}) {
  const sections = [
    ...CAPABILITY_SECTIONS.map(({ id, group, titleKey, backendPath }) => ({
      id,
      titleKey,
      backendPath,
      backends: backendsOf(group),
      fields: fieldsOf(group),
    })),
    ...PLAIN_SECTIONS.map(({ id, titleKey, fields }) => ({ id, titleKey, fields: plainFieldsOf(fields) })),
  ]
  const payload = {
    sections,
    reset: RESET,
    // 页面只知道「怎么改写路径」，不知道这台机器是谁：`/home/x` 在 Windows 上不该被改成 `\`。
    platform: { os: platform.os, pathStyle: platform.pathStyle },
  }
  if (autoconfig !== undefined) payload.autoconfig = autoconfig
  if (health !== undefined) payload.health = health
  return payload
}
