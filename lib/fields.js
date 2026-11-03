/**
 * 可编辑字段表：默认值、校验类型与上限的唯一来源。
 *
 * `kind` 同时决定 schema 的类型（count→number、flag→boolean、choice/text→string）与页面用什么
 * 控件，`max` 是 count 的硬上限。`lib/schema.js` 用它建 schemastery，`lib/describe.js` 用它给
 * 页面 `type` / `max`——同一件事只写一遍。
 */

import { DEFAULTS, PATHS } from './config.js'
import { MAX_LIMIT, MAX_READ } from './limits.js'

/** 后端名提示；注册表本身在 `lib/engines.js`。 */
const BACKEND_HINT = 'Use this unless a tool call names another backend; local_search_status lists the registered names.'

/** 字段表，顺序即配置编辑器里的顺序。 */
export const FIELDS = [
  { path: PATHS.filesBackend, default: DEFAULTS.files.backend, description: `Default filename backend. ${BACKEND_HINT}` },
  { path: PATHS.esPath, default: DEFAULTS.files.everything.esPath, description: 'Absolute path to es.exe; empty auto-detects PATH and common install folders.' },
  {
    path: PATHS.esEncoding,
    default: DEFAULTS.files.everything.esEncoding,
    kind: 'choice',
    // 故意保持自由字符串：schema 收成枚举会让写着其它 TextDecoder 标签的 profile 激活失败。
    description: 'Code page used to decode es.exe output: gbk for a zh-CN console, utf-8 otherwise. Any TextDecoder label is accepted; the page offers these two.',
  },
  { path: PATHS.contentBackend, default: DEFAULTS.content.backend, description: `Default document-content backend. ${BACKEND_HINT}` },
  { path: PATHS.anytxtUrl, default: DEFAULTS.content.anytxt.url, description: 'Local Anytxt JSON-RPC endpoint on this machine (127.0.0.1, localhost or [::1]); :9921 is tried as a fallback.' },
  { path: PATHS.workspaceRoot, default: DEFAULTS.scopes.workspaceRoot, description: 'Directory for scope=workspace; empty uses the session working directory.' },
  { path: PATHS.workRoot, default: DEFAULTS.scopes.workRoot, description: 'Directory for scope=work; required before using that scope.' },
  { path: PATHS.personalRoot, default: DEFAULTS.scopes.personalRoot, description: 'Directory for scope=personal; required before using that scope.' },
  { path: PATHS.allRoots, default: DEFAULTS.scopes.allRoots, description: 'Semicolon-separated roots for Anytxt scope=all; empty uses the platform default roots.' },
  {
    path: PATHS.defaultScope,
    default: DEFAULTS.scopes.defaultScope,
    kind: 'choice',
    choices: [{ value: 'all' }, { value: 'workspace' }, { value: 'work' }, { value: 'personal' }],
    description: 'Scope used when a tool call omits scope: all (whole computer), workspace, work or personal.',
  },
  { path: PATHS.maxResults, default: DEFAULTS.limits.maxResults, kind: 'count', max: MAX_LIMIT, description: `Results per call when the tool omits limit; the hard cap is ${MAX_LIMIT}.` },
  { path: PATHS.readMaxChars, default: DEFAULTS.limits.readMaxChars, kind: 'count', max: MAX_READ, description: `Default local_search_read window; the hard cap is ${MAX_READ} characters.` },
  {
    path: PATHS.checkEnginesOnStart,
    default: DEFAULTS.checkEnginesOnStart,
    kind: 'flag',
    description: 'Probe both engines once on every start and report a failure in the card; off means no startup probe and no card. Test connection and the first-run configuration are unaffected.',
  },
  {
    path: PATHS.autoConfigured,
    default: DEFAULTS.autoConfigured,
    kind: 'flag',
    hidden: true,
    // 隐藏而不是不声明：页面不渲染它，但 settings 只允许写 volatile 路径，自动配置要靠它落盘。
    description: 'Set once the first-run configuration pass has decided what to fill; it keeps a field you cleared from being filled again.',
  },
]

/** `kind` → 页面控件的 `type`。 */
const CONTROL_TYPES = { count: 'count', flag: 'flag', choice: 'choice', text: 'text' }

/**
 * 字段路径（点分）→ 页面需要的 `{ type, max?, choices? }`。
 *
 * describe 用它，schema 从 {@link FIELDS} 建校验，两边不再各写一遍类型和上限。
 * @type {Map<string, {type: string, max?: number, choices?: Array<{value: string}>}>}
 */
export const FIELD_META = new Map(FIELDS.map((field) => {
  const meta = { type: CONTROL_TYPES[field.kind] ?? 'text' }
  if (field.max !== undefined) meta.max = field.max
  if (field.choices !== undefined) meta.choices = field.choices
  return [field.path.join('.'), meta]
}))
