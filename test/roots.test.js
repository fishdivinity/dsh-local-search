import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeRoots, defaultAllRoots, parseAllRoots, rootsFor } from '../lib/roots.js'

test('parseAllRoots splits and trims semicolon lists', () => {
  assert.deepEqual(parseAllRoots('C:\\; D:\\;'), ['C:\\', 'D:\\'])
  assert.deepEqual(parseAllRoots(''), [])
})

test('rootsFor defaults to the workspace root', () => {
  const cwd = process.cwd()
  assert.deepEqual(rootsFor('workspace', undefined, { scopes: { workspaceRoot: cwd } }, cwd), [cwd])
  assert.deepEqual(rootsFor(undefined, undefined, {}, cwd), [cwd])
})

test('rootsFor honors an explicit path', () => {
  const cwd = process.cwd()
  assert.deepEqual(rootsFor('work', cwd, {}, cwd), [cwd])
})

test('rootsFor reports an unconfigured work scope', () => {
  assert.throws(
    () => rootsFor('work', undefined, {}, process.cwd()),
    (error) => error.code === 'SCOPE_NOT_CONFIGURED',
  )
})

test('rootsFor rejects an unknown scope', () => {
  assert.throws(
    () => rootsFor('elsewhere', undefined, {}, process.cwd()),
    (error) => error.code === 'INVALID_SCOPE',
  )
})

test('defaultAllRoots returns existing drive roots', () => {
  const roots = defaultAllRoots()
  assert.ok(roots.length > 0)
  assert.ok(roots.every((root) => /^[A-Z]:\\$/.test(root)))
})

test('dedupeRoots drops a root nested in another, so nothing is counted twice', () => {
  assert.deepEqual(dedupeRoots(['D:\\Alpha', 'D:\\Alpha\\nested', 'E:\\Beta']), ['D:\\Alpha', 'E:\\Beta'])
  // 尾部分隔符与大小写写不出第二棵树。
  assert.deepEqual(dedupeRoots(['D:\\Alpha\\', 'd:\\alpha']), ['D:\\Alpha\\'])
  // 名字只是前缀相同的兄弟目录不算嵌套。
  assert.deepEqual(dedupeRoots(['D:\\Alpha', 'D:\\Alphabet']), ['D:\\Alpha', 'D:\\Alphabet'])
  // 盘根吞掉该盘上的所有路径。
  assert.deepEqual(dedupeRoots(['D:\\', 'D:\\Alpha']), ['D:\\'])
  // 在 Windows 上正斜杠指的是同一棵树。
  assert.deepEqual(dedupeRoots(['D:/Alpha', 'D:\\Alpha\\nested']), ['D:/Alpha'])
})
