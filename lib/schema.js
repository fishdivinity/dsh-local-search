/**
 * Config schema（schemastery）的构造。
 *
 * 字段表是 schema、路径与默认值三者唯一的汇合点：路径来自 `lib/config.js` 的 {@link PATHS}，
 * 默认值来自 {@link DEFAULTS}，描述留在这里（配置编辑器读它，用户界面不读）。
 *
 * 为什么要从字段表拼装而不是手写嵌套字面量：嵌套字面量会把同一条路径写两遍（schema 一遍、
 * describe 一遍、迁移一遍），改一处忘一处就出现「页面能改、工具没读」的静默错位。
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULTS, PATHS, RETIRED_PATHS } from './config.js'
import { MAX_LIMIT, MAX_READ } from './limits.js'

/** 逗号分隔的后端名提示，来自注册表的说明留在 `lib/engines.js`。 */
const BACKEND_HINT = 'Use this unless a tool call names another backend; local_search_status lists the registered names.'

/**
 * 可编辑字段表。
 *
 * `kind: 'count'` 的字段带 `max`，对应 Host 的硬上限；页面从 describe 拿到同一个数，所以
 * 保存不会被 schema 拒绝。
 */
const FIELDS = [
  { path: PATHS.filesBackend, default: DEFAULTS.files.backend, description: `Default filename backend. ${BACKEND_HINT}` },
  { path: PATHS.esPath, default: DEFAULTS.files.everything.esPath, description: 'Absolute path to es.exe; empty auto-detects PATH and common install folders.' },
  {
    path: PATHS.esEncoding,
    default: DEFAULTS.files.everything.esEncoding,
    // 故意保持自由字符串：0.1 接受任意标签并在 decodeEs 里回退 UTF-8，收成枚举会让昨天还能用的 profile 激活失败。
    description: 'Code page used to decode es.exe output: gbk for a zh-CN console, utf-8 otherwise. Any TextDecoder label is accepted; the page offers these two.',
  },
  { path: PATHS.contentBackend, default: DEFAULTS.content.backend, description: `Default document-content backend. ${BACKEND_HINT}` },
  { path: PATHS.anytxtUrl, default: DEFAULTS.content.anytxt.url, description: 'Local Anytxt JSON-RPC endpoint on this machine (127.0.0.1, localhost or [::1]); :9921 is tried as a fallback.' },
  { path: PATHS.workspaceRoot, default: DEFAULTS.scopes.workspaceRoot, description: 'Root for scope=workspace; empty uses the session working directory.' },
  { path: PATHS.workRoot, default: DEFAULTS.scopes.workRoot, description: 'Root for scope=work; required before using that scope.' },
  { path: PATHS.personalRoot, default: DEFAULTS.scopes.personalRoot, description: 'Root for scope=personal; required before using that scope.' },
  { path: PATHS.allRoots, default: DEFAULTS.scopes.allRoots, description: 'Semicolon-separated roots for Anytxt scope=all; empty uses C: and D: when present.' },
  { path: PATHS.maxResults, default: DEFAULTS.limits.maxResults, kind: 'count', max: MAX_LIMIT, description: `Default result cap; the hard cap is ${MAX_LIMIT}.` },
  { path: PATHS.readMaxChars, default: DEFAULTS.limits.readMaxChars, kind: 'count', max: MAX_READ, description: `Default local_search_read window; the hard cap is ${MAX_READ} characters.` },
  {
    path: PATHS.autoConfigured,
    default: DEFAULTS.autoConfigured,
    kind: 'flag',
    hidden: true,
    // 隐藏而不是不声明：页面不渲染它，但 settings 只允许写 volatile 路径，自动配置要靠它落盘。
    description: 'Set once the first-run configuration pass has decided what to fill; it keeps a field you cleared from being filled again.',
  },
]

/** 叶子标记；用 Symbol 是为了让路径键和它永不冲突。 */
const LEAF = Symbol('schema-leaf')

function fieldSchema(field) {
  const base = field.kind === 'count'
    ? z.number().min(1).max(field.max)
    : field.kind === 'flag' ? z.boolean() : z.string()
  const leaf = base.default(field.default).volatile().description(field.description)
  return field.hidden === true ? leaf.hidden() : leaf
}

/**
 * 旧位置的 schema：与目标字段同类型、同默认值，只是位置不同且隐藏。
 *
 * 必须留在 schema 里而不是删掉：settings 只允许写/撤 schema 里有的路径，迁移要靠它把旧键清掉；
 * 隐藏则让配置编辑器不显示它们（页面本来就只按 describe 渲染）。
 * @param field - 目标位置现在的字段
 * @param to - 目标路径，只用于描述
 */
function legacySchema(field, to) {
  const base = field.kind === 'count' ? z.number().min(1).max(field.max) : z.string()
  return base
    .default(field.default)
    .volatile()
    .hidden()
    .description(`Retired path; moved to ${to.join('.')} at startup.`)
}

function insert(tree, path, schema) {
  let node = tree
  for (const key of path.slice(0, -1)) {
    node[key] ??= {}
    node = node[key]
  }
  node[path.at(-1)] = { [LEAF]: schema }
}

/**
 * 这条旧路径还能不能挂进 schema：它经过的每一层都得是对象（或还没建）。
 * @param tree - 正在拼的 schema 树
 * @param path - 旧路径
 * @returns 可以插入时为 true
 */
function canInsert(tree, path) {
  let node = tree
  for (const key of path.slice(0, -1)) {
    if (node[key] === undefined) return true
    if (node[key][LEAF] !== undefined) return false
    node = node[key]
  }
  return true
}

function wrap(tree) {
  const dict = {}
  for (const [key, child] of Object.entries(tree)) {
    dict[key] = child[LEAF] ?? wrap(child)
  }
  return z.object(dict)
}

function build() {
  const tree = {}
  for (const field of FIELDS) insert(tree, field.path, fieldSchema(field))
  const byPath = new Map(FIELDS.map((field) => [field.path.join('.'), field]))
  // 退役路径仍要声明：settings 只允许写/撤 schema 里有的路径，迁移靠它把旧键清掉；隐藏则让
  // 配置编辑器不显示它们（页面本来就只按 describe 渲染）。旧路径的父级可能已经是普通值，
  // 那时 insert 会在它下面建对象把值挤掉——所以只处理父级仍是对象（或不存在）的那些。
  for (const { from, to } of RETIRED_PATHS) {
    const field = byPath.get(to.join('.'))
    if (field === undefined) continue
    if (!canInsert(tree, from)) continue
    insert(tree, from, legacySchema(field, to))
  }
  tree.timeoutMs = { [LEAF]: z.number().default(DEFAULTS.timeoutMs).description('Per-call timeout budget in milliseconds; profile YAML only, because each tool fixes its deadline at registration.') }
  return wrap(tree)
}

/** 插件的 Config schema。 */
export const Config = build()
