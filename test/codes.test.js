/**
 * lib 抛出的错误码字面量必须都能在 docs/troubleshooting.md 的 code 表里查到：码是给用户排查用的，
 * 两份清单一漂移，用户拿着码却在那张表里找不到原因。
 *
 * 扫描用 TypeScript 的解析器（开发期依赖），不手写词法器：注释里的码、正则里的引号、模板插值
 * 都由它分开，退化风险交给编译器。只扫 lib 下的 .js；不负责反向覆盖（文档先列一个码是允许的），
 * 也不校验动态透传的 `error.code`——那类值没有字面量可扫。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const DOC = join(root, 'docs', 'troubleshooting.md')
const CODE = /^[A-Z][A-Z0-9_]{3,}$/

/**
 * 不是错误码的大写字面量。允许表本身有风险：多写一条就放过一个真正的码，所以每项都要一句原因，
 * 且必须仍出现在源码里（第三个测试盯着这两条）。
 */
const ALLOWED = {
  DOWN: 'diagnose 里的状态标签，用户看到的码来自同一对象的 code 字段',
  ENOENT: 'Node 的 errno，用来认出 es.exe 不存在并换成 EVERYTHING_* 码，不会发给用户',
  HEAD: 'HTTP 方法名，只读路由用它判断要不要回 body',
  POST: 'Anytxt JSON-RPC 的 HTTP 方法名',
  SKIPPED: '探测被跳过时的运行时状态，跳过不算故障，也没有对应的错误码',
  UNKNOWN: 'code 缺失时页面与诊断拿来占位的值，不对应任何可排查的故障',
}

/** 只收 .js：lib/locales 是语言包，里面的大写单词不是错误码。 */
function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (entry.name.endsWith('.js')) found.push(path)
  }
  return found
}

/**
 * 取一份源码里的静态字符串字面量。
 * @param {string} source - 文件内容
 * @param {string} fileName - 只用于报错与 ScriptKind 推断
 * @returns {string[]} 形如错误码的字面量
 */
function literalsOf(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const found = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found.filter((value) => CODE.test(value))
}

/** 扫描 lib 一次：code → 出现的文件（相对路径）。 */
function scanLib() {
  const seen = new Map()
  for (const file of walk(join(root, 'lib'))) {
    for (const code of literalsOf(readFileSync(file, 'utf8'), file)) {
      if (!seen.has(code)) seen.set(code, new Set())
      seen.get(code).add(relative(root, file))
    }
  }
  return seen
}

/** 只认每张表的第一列；code 外面可能裹着反引号，对齐用的空格也不算内容。 */
function documentedCodes() {
  const codes = new Set()
  for (const line of readFileSync(DOC, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue
    for (const token of line.split('|')[1]?.match(/[A-Z][A-Z0-9_]{3,}/g) ?? []) codes.add(token)
  }
  return codes
}

test('every error code literal in lib is in the troubleshooting table', () => {
  const documented = documentedCodes()
  const missing = [...scanLib()]
    .filter(([code]) => !documented.has(code) && !Object.hasOwn(ALLOWED, code))
    .map(([code, files]) => `${code} (${[...files].sort().join(', ')})`)
    .sort()
  assert.deepEqual(missing, [], 'document these codes in docs/troubleshooting.md')
})

test('the allowlist explains every literal it hides', () => {
  const silent = Object.entries(ALLOWED)
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([code]) => code)
  assert.deepEqual(silent, [], 'every allowed literal needs a one-sentence reason')
})

test('the allowlist does not outlive the literals it hides', () => {
  // 允许表会腐烂：一个已经删掉的 `HEAD` 若留在表里，下一个真正叫 HEAD 的错误码就被静默放过。
  const seen = scanLib()
  const stale = Object.keys(ALLOWED).filter((code) => !seen.has(code)).sort()
  assert.deepEqual(stale, [], 'remove allowlist entries whose literal no longer exists in lib')
})
