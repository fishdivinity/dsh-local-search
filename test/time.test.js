import test from 'node:test'
import assert from 'node:assert/strict'
import { filetimeToIso } from '../lib/time.js'

test('filetimeToIso converts a FILETIME and ignores empty values', () => {
  assert.equal(filetimeToIso(0), undefined)
  assert.equal(filetimeToIso(-1), undefined)
  const iso = filetimeToIso(134368593493822223)
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})
