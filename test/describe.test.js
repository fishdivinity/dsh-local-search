import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, PATHS, pathValue, readConfig } from '../lib/config.js'
import { describeConfig } from '../lib/describe.js'
import { engineNames } from '../lib/engines.js'
import { MAX_LIMIT, MAX_READ } from '../lib/limits.js'

/** 一份普通配置快照，用来检查 describe 给的路径真的落在配置里。 */
const values = readConfig({})

test('sections run capability first, then the backend-independent fields', () => {
  const { sections } = describeConfig()
  assert.deepEqual(sections.map((section) => section.id), ['files', 'content', 'scopes', 'limits'])
})

test('each capability section offers the registered backends and points at its selection', () => {
  const names = engineNames()
  const byId = Object.fromEntries(describeConfig().sections.map((section) => [section.id, section]))
  assert.deepEqual(byId.files.backends.map((backend) => backend.name), names.files)
  assert.deepEqual(byId.content.backends.map((backend) => backend.name), names.content)
  assert.deepEqual(byId.files.backendPath, PATHS.filesBackend)
  assert.deepEqual(byId.content.backendPath, PATHS.contentBackend)
  // 与后端无关的节没有选择器。
  assert.equal(byId.scopes.backendPath, undefined)
  assert.equal(byId.limits.backendPath, undefined)
})

test('every registered backend is described, so a new engine cannot be silently unconfigurable', () => {
  const names = engineNames()
  const fields = describeConfig().sections
    .filter((section) => section.backendPath !== undefined)
    .flatMap((section) => section.fields)
  for (const group of ['files', 'content']) {
    for (const name of names[group]) {
      assert.ok(fields.some((field) => field.backend === name), `${name} has no described field`)
    }
  }
})

test('every described field path resolves in a configuration snapshot', () => {
  for (const section of describeConfig().sections) {
    for (const field of section.fields) {
      const value = pathValue(values, field.path)
      assert.notEqual(value, undefined, field.path.join('.'))
      if (field.type === 'count') {
        assert.equal(typeof value, 'number', field.path.join('.'))
        assert.match(field.path.at(-1), /^(maxResults|readMaxChars)$/)
      } else if (field.type === 'choice') {
        assert.ok(field.choices.some((choice) => choice.value === value), field.path.join('.'))
      } else {
        assert.equal(field.type, 'text')
        assert.equal(typeof value, 'string', field.path.join('.'))
      }
    }
  }
})

test('count fields carry the Host hard caps, so a page save is never rejected', () => {
  const fields = describeConfig().sections.find((section) => section.id === 'limits').fields
  assert.deepEqual(fields.map((field) => [field.path.at(-1), field.max]), [
    ['maxResults', MAX_LIMIT],
    ['readMaxChars', MAX_READ],
  ])
})

test('the endpoint field is the one the Test control probes, and it is loopback-only', () => {
  const fields = describeConfig().sections
    .filter((section) => section.backendPath !== undefined)
    .flatMap((section) => section.fields)
  const probing = fields.filter((field) => field.probeEndpoint === true)
  assert.equal(probing.length, 1)
  assert.deepEqual(probing[0].path, PATHS.anytxtUrl)
  assert.equal(probing[0].localUrl, true)
  assert.equal(probing[0].backend, 'anytxt')
})

test('the code-page field keeps the aliases an 0.1 profile may still carry', () => {
  const field = describeConfig().sections
    .flatMap((section) => section.fields)
    .find((candidate) => candidate.type === 'choice')
  assert.deepEqual(field.choices.map((choice) => choice.value), ['gbk', 'utf-8'])
  assert.equal(field.aliases.utf8, 'utf-8')
  assert.equal(field.aliases.utf, 'utf-8')
})

test('every field carries the dictionary keys the page renders with', () => {
  for (const section of describeConfig().sections) {
    assert.equal(typeof section.titleKey, 'string')
    for (const field of section.fields) {
      assert.equal(typeof field.labelKey, 'string', field.path.join('.'))
      assert.equal(typeof field.hintKey, 'string', field.path.join('.'))
      for (const choice of field.choices ?? []) assert.equal(typeof choice.labelKey, 'string')
    }
  }
})

test('the reset recipe clears the engine and limits, keeps the scopes', () => {
  const { reset } = describeConfig()
  const cleared = reset.clear.map((path) => path.join('.'))
  for (const path of ['files.everything.esPath', 'files.everything.esEncoding', 'content.anytxt.url', 'limits.maxResults', 'limits.readMaxChars']) {
    assert.ok(cleared.includes(path), `${path} must be cleared`)
  }
  // 检索范围是用户手填的机器路径，重置不该顺手抹掉。
  for (const path of cleared) assert.ok(!path.startsWith('scopes.'), `${path} must survive a reset`)
  assert.deepEqual(reset.fills.map((fill) => fill.from), ['everything.path', 'anytxt.url'])
  assert.deepEqual(reset.marker, PATHS.autoConfigured)
  assert.equal(reset.fills[1].default, DEFAULTS.content.anytxt.url)
})

test('autoconfig rides the payload only when the caller passes it', () => {
  assert.equal(describeConfig().autoconfig, undefined)
  const state = { pending: false, ran: true, failures: [{ engine: 'anytxt', code: 'ANYTXT_DOWN' }] }
  assert.deepEqual(describeConfig(state).autoconfig, state)
})
