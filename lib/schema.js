/**
 * Config schema（schemastery）的构造。
 *
 * 字段表在 `lib/fields.js`（路径、默认值、控件类型与上限的唯一来源），这里只负责把它拼成
 * schemastery 树，再补上退役路径与 `timeoutMs`。
 *
 * 为什么要从字段表拼装而不是手写嵌套字面量：嵌套字面量会把同一条路径写两遍（schema 一遍、
 * describe 一遍、迁移一遍），改一处忘一处就出现「页面能改、工具没读」的静默错位。
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULTS, RETIRED_PATHS } from './config.js'
import { FIELDS } from './fields.js'

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
