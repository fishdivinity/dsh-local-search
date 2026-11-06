import test from 'node:test'
import assert from 'node:assert/strict'
import { declareOwnSettingsPage } from '../lib/settings-page.js'

test('a settings service without the page policy hook is left alone', () => {
  const settingsCtx = { get: () => ({}) }
  assert.equal(declareOwnSettingsPage({ fiber: {} }, settingsCtx), undefined)
})

test('the page policy is declared once, against the plugin fiber', () => {
  const fiber = { id: 'plugin' }
  const calls = []
  const disposer = () => {}
  const settings = {
    configure: (policy, owner) => {
      calls.push([policy, owner])
      return disposer
    },
  }
  assert.equal(declareOwnSettingsPage({ fiber }, { get: () => settings }), disposer)
  assert.deepEqual(calls, [[{ auto: false }, fiber]], 'the policy names the plugin, not the child context')
})

test('a context without a fiber declares nothing rather than guessing', () => {
  const settings = {
    configure: () => {
      throw new Error('configure must not be called without a fiber')
    },
  }
  assert.equal(declareOwnSettingsPage({}, { get: () => settings }), undefined)
})
