import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { detect, expandHome, isAbsolutePath, normalizePath, normalizePaths, pathStyleOf } from '../lib/platform.js'

test('detect lists every existing Windows drive root', () => {
  const platform = detect('win32', { exists: (path) => path === 'C:\\' || path === 'D:\\' })
  assert.equal(platform.os, 'win32')
  assert.equal(platform.pathStyle, 'windows')
  assert.equal(platform.caseInsensitive, true)
  assert.deepEqual(platform.defaultAllRoots, ['C:\\', 'D:\\'])
})

test('detect drops a drive that does not exist', () => {
  const platform = detect('win32', { exists: (path) => path === 'C:\\' })
  assert.deepEqual(platform.defaultAllRoots, ['C:\\'])
})

test('detect picks up a drive added after the previous call', () => {
  let present = ['C:\\', 'D:\\']
  const io = { exists: (path) => present.includes(path) }
  assert.deepEqual(detect('win32', io).defaultAllRoots, ['C:\\', 'D:\\'])
  present = ['C:\\', 'D:\\', 'E:\\']
  assert.deepEqual(detect('win32', io).defaultAllRoots, ['C:\\', 'D:\\', 'E:\\'])
})

test('detect reads /home on Linux and does not fold case', () => {
  const platform = detect('linux', { exists: (path) => path === '/home' })
  assert.equal(platform.pathStyle, 'posix')
  assert.equal(platform.caseInsensitive, false)
  assert.deepEqual(platform.defaultAllRoots, ['/home'])
})

test('detect reads /Users and every mounted volume on macOS', () => {
  const platform = detect('darwin', {
    home: '/Users/me',
    exists: (path) => path === '/Users' || path === '/Volumes/Ext',
    readdir: (directory) => (directory === '/Volumes' ? ['Ext'] : []),
  })
  assert.equal(platform.home, '/Users/me')
  assert.equal(platform.caseInsensitive, true)
  assert.deepEqual(platform.defaultAllRoots, ['/Users', '/Volumes/Ext'])
})

test('an unknown platform is treated as POSIX rather than guessed', () => {
  const platform = detect('aix', { exists: () => false })
  assert.equal(platform.os, 'linux')
  assert.equal(platform.pathStyle, 'posix')
  assert.deepEqual(platform.defaultAllRoots, [])
})

test('pathStyleOf accepts a name or a detected platform', () => {
  assert.equal(pathStyleOf('win32'), 'windows')
  assert.equal(pathStyleOf('darwin'), 'posix')
  assert.equal(pathStyleOf({ os: 'linux', pathStyle: 'posix' }), 'posix')
  assert.equal(pathStyleOf({ os: 'win32', pathStyle: 'windows' }), 'windows')
})

test('expandHome expands ~ and ~/x, and leaves ~user alone', () => {
  const posix = { os: 'darwin', pathStyle: 'posix', home: '/Users/me' }
  assert.equal(expandHome('~/docs', posix), '/Users/me/docs')
  assert.equal(expandHome('~', posix), '/Users/me')
  assert.equal(expandHome('~other/docs', posix), '~other/docs')
  assert.equal(expandHome('/Users/x', posix), '/Users/x')
  const windows = { os: 'win32', pathStyle: 'windows', home: 'C:\\Home\\me' }
  assert.equal(expandHome('~\\docs\\a', windows), 'C:\\Home\\me\\docs\\a')
  assert.equal(expandHome('~/docs', windows), 'C:\\Home\\me\\docs')
})

test('expandHome refuses to invent a home directory it does not have', () => {
  assert.equal(expandHome('~/docs', { pathStyle: 'posix', home: '' }), '~/docs')
})

test('normalizePath rewrites Windows spellings and leaves POSIX ones alone', () => {
  assert.equal(normalizePath('d:/Alpha/', 'win32'), 'D:\\Alpha')
  assert.equal(normalizePath('D:\\', 'win32'), 'D:\\')
  assert.equal(normalizePath('\\\\server\\share\\x\\', 'win32'), '\\\\server\\share\\x')
  assert.equal(normalizePath('/home/me/', 'win32'), '/home/me/')
  assert.equal(normalizePath('~/docs', 'win32'), '~/docs')
  assert.equal(normalizePath('/home/me/', 'linux'), '/home/me/')
  assert.equal(normalizePath('d:/Alpha/', 'linux'), 'd:/Alpha/')
  assert.equal(normalizePath('  ', 'linux'), '')
})

test('normalizePaths rewrites each semicolon entry and drops empty ones', () => {
  assert.equal(normalizePaths('d:/Alpha/; E:\\Beta ;', 'win32'), 'D:\\Alpha;E:\\Beta')
  assert.equal(normalizePaths('/home/a; /home/b;', 'linux'), '/home/a;/home/b')
})

test('isAbsolutePath follows the target platform, not the host', () => {
  assert.equal(isAbsolutePath('D:\\Alpha', 'win32'), true)
  assert.equal(isAbsolutePath('D:/Alpha', 'win32'), true)
  assert.equal(isAbsolutePath('\\\\server\\share', 'win32'), true)
  assert.equal(isAbsolutePath('/Users/x', 'win32'), true)
  assert.equal(isAbsolutePath('~', 'win32'), true)
  assert.equal(isAbsolutePath('relative\\path', 'win32'), false)
  assert.equal(isAbsolutePath('C:relative', 'win32'), false)
  assert.equal(isAbsolutePath('/home/me', 'linux'), true)
  assert.equal(isAbsolutePath('C:\\Alpha', 'linux'), false)
  assert.equal(isAbsolutePath('relative/path', 'linux'), false)
})

test('the default home is the real one only for the real platform', () => {
  const platform = detect()
  assert.equal(platform.home, homedir())
})
