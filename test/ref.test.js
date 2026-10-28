import test from 'node:test'
import assert from 'node:assert/strict'
import { assertRefEngine, formatRef, parseRef } from '../lib/ref.js'

test('formatRef and parseRef round-trip engine-scoped ids', () => {
  const ref = formatRef('anytxt', '123')
  assert.equal(ref, 'anytxt:123')
  assert.deepEqual(parseRef(ref), { engine: 'anytxt', id: '123' })
})

test('parseRef rejects bare or malformed refs with INVALID_REF', () => {
  for (const value of ['123', '', ':', 'anytxt:']) {
    assert.throws(
      () => parseRef(value),
      (error) => error.code === 'INVALID_REF',
    )
  }
})

test('assertRefEngine rejects a cross-engine ref', () => {
  assert.throws(
    () => assertRefEngine(parseRef('recoll:12'), 'anytxt'),
    (error) => error.code === 'INVALID_REF',
  )
})
