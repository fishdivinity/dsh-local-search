import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { allRootsFor, dedupeRoots, defaultAllRoots, parseAllRoots, rootsFor } from '../lib/roots.js'
import { detect } from '../lib/platform.js'

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

test('defaultAllRoots takes its candidates from the platform, not the host', () => {
  assert.deepEqual(
    defaultAllRoots(detect('linux', { exists: (path) => path === '/home' })),
    ['/home'],
  )
})

test('rootsFor expands ~ before handing a root to an engine', () => {
  assert.deepEqual(rootsFor('workspace', '~', {}, undefined), [homedir()])
})

test('scope=all falls back to the workspace when every configured root is gone', () => {
  const cwd = process.cwd()
  const resolved = allRootsFor({ scopes: { allRoots: 'Z:\\no-such-root-for-dsh-test\\' } }, cwd)
  assert.equal(resolved.fellBack, true)
  assert.deepEqual(resolved.roots, [cwd])
  // 配置为空不算「和用户设的不一致」：按平台默认根来，不标 fallback。
  const defaults = allRootsFor({ scopes: { allRoots: '' } }, cwd)
  assert.equal(defaults.fellBack, false)
  // 但平台也没有默认根时，同样退回了 workspace：标记必须亮，否则就是悄悄降级。
  const empty = allRootsFor({ scopes: { allRoots: '' } }, cwd, {
    pathStyle: process.platform === 'win32' ? 'windows' : 'posix',
    defaultAllRoots: [],
    home: homedir(),
  })
  assert.equal(empty.fellBack, true)
  assert.deepEqual(empty.roots, [cwd])
  // 只有一部分配置根不在：不回落，但要把缺失的那几个标出来，结果不能悄悄变少。
  const partial = allRootsFor({ scopes: { allRoots: `${cwd};Z:\\no-such-root-for-dsh-test\\` } }, cwd)
  assert.equal(partial.fellBack, false)
  assert.deepEqual(partial.roots, [cwd])
  assert.deepEqual(partial.missing, ['Z:\\no-such-root-for-dsh-test\\'])
})

test('dedupeRoots keeps POSIX siblings whose names only share a prefix', () => {
  assert.deepEqual(
    dedupeRoots(['/Users/me', '/Users/me/docs', '/Volumes/Ext'], { pathStyle: 'posix', caseInsensitive: true }),
    ['/Users/me', '/Volumes/Ext'],
  )
  // 大小写敏感的文件系统上，两个目录是两棵树。
  assert.deepEqual(
    dedupeRoots(['/home/A', '/home/a'], { pathStyle: 'posix', caseInsensitive: false }),
    ['/home/A', '/home/a'],
  )
  // 根目录吞掉它下面的所有路径。
  assert.deepEqual(dedupeRoots(['/', '/home/me'], { pathStyle: 'posix', caseInsensitive: false }), ['/'])
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
