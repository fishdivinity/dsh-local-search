import test from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_KEYS, liveValue, readConfig, validateConfig } from '../lib/config.js'

/** A config object shaped like the schema output, with live references where declared. */
function liveConfig(overrides = {}) {
  const base = {
    esPath: '',
    anytxtUrl: 'http://127.0.0.1:9920',
    workspaceRoot: '',
    workRoot: '',
    personalRoot: '',
    allRoots: '',
    maxResults: 20,
    timeoutMs: 30000,
    readMaxChars: 8000,
    esEncoding: 'gbk',
  }
  const values = { ...base, ...overrides }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, LIVE_KEYS.includes(key) ? { get: () => value } : value]),
  )
}

test('liveValue reads a reference and passes plain values through', () => {
  assert.equal(liveValue({ get: () => 'gbk' }), 'gbk')
  assert.equal(liveValue('gbk'), 'gbk')
  assert.equal(liveValue(undefined), undefined)
})

test('readConfig unwraps every editable field and keeps timeoutMs plain', () => {
  const snapshot = readConfig(liveConfig({ workRoot: 'sample-root' }))
  assert.equal(snapshot.workRoot, 'sample-root')
  assert.equal(snapshot.maxResults, 20)
  assert.equal(snapshot.timeoutMs, 30000)
  assert.ok(!LIVE_KEYS.includes('timeoutMs'))
})

test('readConfig follows a reference that changed after registration', () => {
  let current = 20
  const config = { ...liveConfig(), maxResults: { get: () => current } }
  assert.equal(readConfig(config).maxResults, 20)
  current = 55
  assert.equal(readConfig(config).maxResults, 55)
})

test('validateConfig accepts a valid config and returns the snapshot', () => {
  const values = validateConfig(liveConfig({ maxResults: 50 }), 2147483647)
  assert.equal(values.maxResults, 50)
})

test('validateConfig rejects non-positive integers', () => {
  assert.throws(() => validateConfig(liveConfig({ maxResults: 0 })), /maxResults must be a positive integer/)
  assert.throws(() => validateConfig(liveConfig({ readMaxChars: 1.5 })), /readMaxChars must be a positive integer/)
})

test('a non-local endpoint still activates, so an 0.1 profile is never rejected', () => {
  // The loopback rule is enforced where the endpoint is used (lib/anytxt.js), so
  // a stale address fails the content engine instead of the whole plugin.
  for (const url of ['http://127.0.0.1:9920', 'http://localhost:9921', 'https://[::1]:9920', 'http://192.168.1.20:9920']) {
    assert.doesNotThrow(() => validateConfig(liveConfig({ anytxtUrl: url })), url)
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
