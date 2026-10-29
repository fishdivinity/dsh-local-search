import test from 'node:test'
import assert from 'node:assert/strict'
import { filetimeToIso, formatContent, formatFiles, formatFragments, formatRead, formatStatus } from '../lib/format.js'

test('filetimeToIso converts a FILETIME and ignores empty values', () => {
  assert.equal(filetimeToIso(0), undefined)
  assert.equal(filetimeToIso(-1), undefined)
  const iso = filetimeToIso(134368593493822223)
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test('formatFiles renders items, sizes, dates, and the capped header', () => {
  const value = {
    items: [{ path: 'D:\\docs\\a.pdf', size: 12, modified: '2026-01-01T00:00:00.000Z' }],
    truncated: true,
  }
  const text = formatFiles(value)
  assert.match(text, /Found 1 path\(s\) \(capped\)/)
  assert.match(text, /D:\\docs\\a\.pdf\t12 B\t2026-01-01T00:00:00\.000Z/)
})

test('formatFiles handles an empty result', () => {
  assert.equal(formatFiles({ items: [], truncated: false }), 'No files found.')
  // Everything was capped before the index filter, so the window can be empty
  // while matches existed: say so rather than claim there are none.
  assert.match(formatFiles({ items: [], truncated: true }), /No files found in the returned window/)
})

test('formatContent renders refs and total', () => {
  const text = formatContent({
    items: [{ ref: 'fid-1', path: 'D:\\docs\\a.pdf' }],
    total: 7,
    truncated: true,
  })
  assert.match(text, /1 of 7 indexed file\(s\) match/)
  assert.match(text, /fid-1\tD:\\docs\\a\.pdf/)
})

test('formatFragments joins snippets and handles empty', () => {
  assert.equal(formatFragments({ fragments: ['a', 'b'] }), 'a\n---\nb')
  assert.equal(formatFragments({ fragments: [] }), 'No fragments returned.')
})

test('formatRead reports the total and the shown window', () => {
  const text = formatRead({ text: 'hello', totalChars: 10, offset: 2, returned: 5 })
  // Inclusive end, so 5 characters starting at 2 read as 2..6.
  assert.match(text, /chars 10; showing 2\.\.6/)
  assert.match(text, /hello/)
})

test('formatRead says so when the window is past the end', () => {
  const text = formatRead({ text: '', totalChars: 10, offset: 10, returned: 0 })
  assert.match(text, /nothing to show at offset 10/)
})

test('formatStatus marks skipped probes and lists registered engines', () => {
  const text = formatStatus({
    everything: { ok: false, code: 'SKIPPED', message: 'not checked because engine=anytxt' },
    anytxt: { ok: true, url: 'http://127.0.0.1:9920' },
    engines: { files: ['everything'], content: ['anytxt'] },
    roots: { workspace: 'D:\\Projects' },
  })
  assert.match(text, /Everything: SKIPPED/)
  assert.match(text, /Anytxt: OK/)
  assert.match(text, /engines=files:everything content:anytxt/)
})

test('formatStatus shows both engines and roots', () => {
  const text = formatStatus({
    everything: { ok: true, version: '1.4.1.1030', path: 'C:\\Everything\\es.exe' },
    anytxt: { ok: false, code: 'ANYTXT_DOWN', message: 'not running' },
    roots: { workspace: 'D:\\Projects', work: 'D:\\Projects', personal: 'D:\\Documents', all: ['C:\\', 'D:\\'] },
  })
  assert.match(text, /Everything: OK \(1\.4\.1\.1030\)/)
  assert.match(text, /Anytxt: DOWN — ANYTXT_DOWN: not running/)
  assert.match(text, /all=C:\\,D:\\/)
})

test('a cancelled probe reads as ABORTED, not as a dead engine', () => {
  const text = formatStatus({
    everything: { ok: false, code: 'EVERYTHING_ABORTED', message: 'aborted' },
    anytxt: { ok: false, code: 'ANYTXT_ABORTED', message: 'aborted' },
    roots: {},
  })
  assert.match(text, /Everything: ABORTED — EVERYTHING_ABORTED/)
  assert.match(text, /Anytxt: ABORTED — ANYTXT_ABORTED/)
  assert.doesNotMatch(text, /DOWN/)
})
