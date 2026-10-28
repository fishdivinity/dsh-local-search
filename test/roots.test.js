import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultAllRoots, parseAllRoots, rootsFor } from '../lib/roots.js'

test('parseAllRoots splits and trims semicolon lists', () => {
  assert.deepEqual(parseAllRoots('C:\\; D:\\;'), ['C:\\', 'D:\\'])
  assert.deepEqual(parseAllRoots(''), [])
})

test('rootsFor defaults to the workspace root', () => {
  const cwd = process.cwd()
  assert.deepEqual(rootsFor('workspace', undefined, { workspaceRoot: cwd }, cwd), [cwd])
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
