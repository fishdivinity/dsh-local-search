import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULTS, PATHS, RETIRED_PATHS, hasPath, isLoopbackUrl, liveValue, pathValue, readConfig, setPath, validateConfig,
} from '../lib/config.js'

/**
 * 一份形状像 schema 输出的配置：可编辑字段都是活引用，`timeoutMs` 是普通值。
 * @param overrides - 字段名（{@link PATHS} 的键）到值；`timeoutMs` 直接给值
 */
function liveConfig(overrides = {}) {
  const config = {}
  for (const [name, path] of Object.entries(PATHS)) {
    const value = name in overrides ? overrides[name] : pathValue(DEFAULTS, path)
    setPath(config, path, { get: () => value })
  }
  config.timeoutMs = 'timeoutMs' in overrides ? overrides.timeoutMs : DEFAULTS.timeoutMs
  return config
}

test('liveValue reads a reference and passes plain values through', () => {
  assert.equal(liveValue({ get: () => 'gbk' }), 'gbk')
  assert.equal(liveValue('gbk'), 'gbk')
  assert.equal(liveValue(undefined), undefined)
})

test('pathValue and hasPath walk nested configuration', () => {
  const config = { files: { everything: { esPath: 'C:/es.exe' } } }
  assert.equal(pathValue(config, PATHS.esPath), 'C:/es.exe')
  assert.equal(pathValue(config, PATHS.anytxtUrl), undefined)
  assert.equal(hasPath(config, PATHS.esPath), true)
  assert.equal(hasPath(config, PATHS.anytxtUrl), false)
  assert.equal(hasPath({ files: {} }, PATHS.esPath), false)
})

test('readConfig unwraps every editable field and keeps timeoutMs plain', () => {
  const snapshot = readConfig(liveConfig({ workRoot: 'sample-root' }))
  assert.equal(snapshot.scopes.workRoot, 'sample-root')
  assert.equal(snapshot.limits.maxResults, 20)
  assert.equal(snapshot.files.backend, 'everything')
  assert.equal(snapshot.content.anytxt.url, 'http://127.0.0.1:9920')
  assert.equal(snapshot.timeoutMs, 30000)
})

test('readConfig fills the nested defaults for an empty profile', () => {
  // profile 行是 config: {}，schema 补上默认值，读侧再补一层，所以这里不能出现 undefined。
  assert.deepEqual(readConfig({}), DEFAULTS)
})

test('the autoconfiguration marker rides the snapshot', () => {
  assert.equal(readConfig({}).autoConfigured, false)
  assert.equal(readConfig(liveConfig({ autoConfigured: true })).autoConfigured, true)
})

test('readConfig follows a reference that changed after registration', () => {
  let current = 20
  const config = liveConfig()
  setPath(config, PATHS.maxResults, { get: () => current })
  assert.equal(readConfig(config).limits.maxResults, 20)
  current = 55
  assert.equal(readConfig(config).limits.maxResults, 55)
})

test('readConfig accepts a whole subtree wrapped as one live reference', () => {
  const values = { esPath: 'D:/tools/es.exe', esEncoding: 'utf-8' }
  const config = { files: { backend: 'everything', everything: { get: () => values } } }
  assert.equal(readConfig(config).files.everything.esPath, 'D:/tools/es.exe')
})

test('every flat key of 0.1 and 0.2 still configures its field', () => {
  // 两版用的是同一批扁平键：九个可编辑字段 + 一直留在顶层的 timeoutMs。
  const values = { esPath: 'D:/es.exe', esEncoding: 'utf-8', anytxtUrl: 'http://127.0.0.1:9921', workspaceRoot: 'D:/Alpha', workRoot: 'E:/Beta', personalRoot: 'F:/Gamma', allRoots: 'C:\\;D:\\', maxResults: 50, readMaxChars: 5000 }
  const config = liveConfig({ esPath: '', esEncoding: DEFAULTS.files.everything.esEncoding, anytxtUrl: DEFAULTS.content.anytxt.url, workspaceRoot: '', workRoot: '', personalRoot: '', allRoots: '', maxResults: DEFAULTS.limits.maxResults, readMaxChars: DEFAULTS.limits.readMaxChars })
  for (const { from } of RETIRED_PATHS) setPath(config, from, { get: () => pathValue(values, from) })
  config.timeoutMs = 12345
  const snapshot = readConfig(config)
  assert.equal(snapshot.files.everything.esPath, 'D:/es.exe')
  assert.equal(snapshot.files.everything.esEncoding, 'utf-8')
  assert.equal(snapshot.content.anytxt.url, 'http://127.0.0.1:9921')
  assert.equal(snapshot.scopes.workspaceRoot, 'D:/Alpha')
  assert.equal(snapshot.scopes.workRoot, 'E:/Beta')
  assert.equal(snapshot.scopes.personalRoot, 'F:/Gamma')
  assert.equal(snapshot.scopes.allRoots, 'C:\\;D:\\')
  assert.equal(snapshot.limits.maxResults, 50)
  assert.equal(snapshot.limits.readMaxChars, 5000)
  // timeoutMs 一直是顶层普通值，迁移不碰它。
  assert.equal(snapshot.timeoutMs, 12345)
})

test('a nested value that differs from its default wins over the flat key', () => {
  const config = liveConfig({ esEncoding: 'utf-8' })
  config.esEncoding = { get: () => 'gbk' }
  assert.equal(readConfig(config).files.everything.esEncoding, 'utf-8')
})

test('an empty flat key never overrides the default', () => {
  const config = liveConfig()
  config.esPath = { get: () => '   ' }
  assert.equal(readConfig(config).files.everything.esPath, '')
})

test('validateConfig accepts a valid config and returns the snapshot', () => {
  const values = validateConfig(liveConfig({ maxResults: 50 }), 2147483647)
  assert.equal(values.limits.maxResults, 50)
})

test('validateConfig rejects non-positive integers and nameless backends', () => {
  assert.throws(() => validateConfig(liveConfig({ maxResults: 0 })), /limits\.maxResults must be a positive integer/)
  assert.throws(() => validateConfig(liveConfig({ readMaxChars: 1.5 })), /limits\.readMaxChars must be a positive integer/)
  assert.throws(() => validateConfig(liveConfig({ filesBackend: '  ' })), /files\.backend must name a backend/)
  assert.throws(() => validateConfig(liveConfig({ contentBackend: '' })), /content\.backend must name a backend/)
})

test('a non-local endpoint still activates, so a 0.1 profile is never rejected', () => {
  // loopback 规则在执行处（lib/anytxt.js）才生效，所以过期地址只会让内容引擎失败。
  for (const url of ['http://127.0.0.1:9920', 'http://localhost:9921', 'https://[::1]:9920', 'http://192.168.1.20:9920']) {
    assert.doesNotThrow(() => validateConfig(liveConfig({ anytxtUrl: url })), url)
  }
})

test('isLoopbackUrl accepts this machine and nothing else', () => {
  for (const url of ['http://127.0.0.1:9920', 'http://localhost', 'https://[::1]:9920']) {
    assert.equal(isLoopbackUrl(url), true, url)
  }
  for (const url of ['http://192.168.1.20:9920', 'https://example.com', 'ftp://127.0.0.1', 'not a url', '']) {
    assert.equal(isLoopbackUrl(url), false, url)
  }
})

test('an 0.1-era code page still validates, so an upgrade never rejects a working profile', () => {
  for (const encoding of ['gbk', 'utf-8', 'utf8', 'gb18030', '']) {
    assert.doesNotThrow(() => validateConfig(liveConfig({ esEncoding: encoding })), encoding)
  }
})

test('validateConfig enforces the timer ceiling only when one is supplied', () => {
  assert.throws(() => validateConfig(liveConfig({ timeoutMs: 2_000_000_000 }), 1000), /no greater than 1000/)
  assert.doesNotThrow(() => validateConfig(liveConfig({ timeoutMs: 2_000_000_000 })))
})
