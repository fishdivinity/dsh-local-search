import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseEverything } from '../lib/probe.js'

test('a missing es.exe on an installed Everything reads as es-missing', () => {
  assert.equal(diagnoseEverything('EVERYTHING_ES_NOT_FOUND', { installed: true, known: true }), 'es-missing')
})

test('a dead connection on an installed Everything reads as not-running', () => {
  assert.equal(diagnoseEverything('EVERYTHING_DOWN', { installed: true, known: true }), 'not-running')
})

test('an absent Everything reads as not-installed, whatever es.exe did', () => {
  assert.equal(diagnoseEverything('EVERYTHING_ES_NOT_FOUND', { installed: false, known: true }), 'not-installed')
  assert.equal(diagnoseEverything('EVERYTHING_DOWN', { installed: false, known: true }), 'not-installed')
})

test('a check that could not run reads as unknown, never as not-installed', () => {
  // 让人去装一个已经装好的东西，比给一句含糊的提示更糟。
  assert.equal(diagnoseEverything('EVERYTHING_DOWN', { installed: false, known: false }), 'unknown')
})
