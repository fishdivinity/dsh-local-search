import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEsArgs, decodeEs, esCandidates, parseEsJson } from '../lib/everything.js'

test('buildEsArgs keeps the model text after -- and scopes with -path', () => {
  const dir = process.cwd()
  assert.deepEqual(buildEsArgs({ query: '*.md', limit: 5, dir }), [
    '-n',
    '5',
    '-json',
    '-size',
    '-date-modified',
    '-path',
    dir,
    '--',
    '*.md',
  ])
})

test('buildEsArgs cannot turn a query into a switch', () => {
  const args = buildEsArgs({ query: '-exit', limit: 1 })
  assert.equal(args[args.length - 2], '--')
  assert.equal(args[args.length - 1], '-exit')
  assert.ok(!args.includes('-export-json'))
})

test('buildEsArgs rejects empty queries and missing dirs', () => {
  assert.throws(() => buildEsArgs({ query: '   ' }), /non-empty/)
  assert.throws(() => buildEsArgs({ query: 'x', dir: 'D:\\no-such-dir-xyz' }), /existing absolute directory/)
})

test('parseEsJson maps rows and filters VCS/system noise', () => {
  const json = JSON.stringify([
    { filename: 'D:\\docs\\a.pdf', size: 10, date_modified: 134368593493822223 },
    { filename: 'D:\\$RECYCLE.BIN\\x.pdf', size: 1, date_modified: 1 },
    { filename: 'D:\\System Volume Information\\y.pdf', size: 1, date_modified: 1 },
  ])
  const rows = parseEsJson(json)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].path, 'D:\\docs\\a.pdf')
  assert.equal(rows[0].size, 10)
  assert.match(rows[0].modified, /^\d{4}-\d{2}-\d{2}T/)
})

test('parseEsJson handles empty output and rejects non-arrays', () => {
  assert.deepEqual(parseEsJson(''), [])
  assert.throws(() => parseEsJson('{"x":1}'), /not an array/)
  assert.throws(() => parseEsJson('not json'), /unparsable/)
})

test('decodeEs decodes GBK output when the runtime supports it', { skip: !supportsGbk() }, () => {
  const bytes = Buffer.from([0xb7, 0xbd, 0xb0, 0xb8, 0xc9, 0xe8, 0xbc, 0xc6])
  assert.equal(decodeEs(bytes, 'gbk'), '方案设计')
})

test('esCandidates points at common install locations', () => {
  const candidates = esCandidates()
  assert.ok(candidates.some((path) => path.endsWith('Everything\\es.exe')))
})

function supportsGbk() {
  try {
    new TextDecoder('gbk')
    return true
  } catch {
    return false
  }
}
