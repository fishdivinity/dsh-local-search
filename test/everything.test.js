import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineError } from '../lib/errors.js'
import {
  buildEsArgs,
  classifyEverything,
  decodeEs,
  esCandidates,
  everythingCandidates,
  isFailedExit,
  parseEsJson,
  probe,
  resolveEsPath,
  withoutExcludedPaths,
} from '../lib/everything.js'

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

test('parseEsJson maps every row and leaves the exclusion filter to its caller', () => {
  const json = JSON.stringify([
    { filename: 'D:\\docs\\a.pdf', size: 10, date_modified: 134368593493822223 },
    { filename: 'D:\\$RECYCLE.BIN\\x.pdf', size: 1, date_modified: 1 },
    { filename: 'D:\\System Volume Information\\y.pdf', size: 1, date_modified: 1 },
  ])
  const rows = parseEsJson(json)
  // 上限在过滤之前就量过了，所以解析这一层必须原样留下全部行。
  assert.equal(rows.length, 3)
  assert.equal(rows[0].path, 'D:\\docs\\a.pdf')
  assert.equal(rows[0].size, 10)
  assert.match(rows[0].modified, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(withoutExcludedPaths(rows).map((row) => row.path), ['D:\\docs\\a.pdf'])
})

test('an empty stdout makes exit 1 a failure, a real answer keeps it a result', () => {
  // es.exe 在「没有命中」和「连不上 Everything」时都退 1，只能靠 stdout 分辨。
  assert.equal(isFailedExit(0, ''), false)
  assert.equal(isFailedExit(1, '[]'), false)
  assert.equal(isFailedExit(1, ''), true)
  assert.equal(isFailedExit(2, '[]'), true)
})

test('everythingCandidates names both Program Files locations', () => {
  const candidates = everythingCandidates()
  assert.equal(candidates.length, 2)
  assert.ok(candidates.every((path) => path.endsWith('Everything\\Everything.exe')))
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

test('a missing es.exe is missing-tool, and the install evidence picks the fix', () => {
  assert.deepEqual(classifyEverything('EVERYTHING_ES_NOT_FOUND', { installed: true, known: true }), {
    state: 'missing-tool',
    detail: 'es-missing',
  })
  assert.deepEqual(classifyEverything('EVERYTHING_ES_NOT_FOUND', { installed: false, known: true }), {
    state: 'missing-tool',
    detail: 'not-installed',
  })
  // 让一个已经装了的人去安装，比给一句含糊的提示更糟。
  assert.deepEqual(classifyEverything('EVERYTHING_ES_NOT_FOUND', { installed: false, known: false }), {
    state: 'missing-tool',
    detail: 'unknown',
  })
})

test('everything else es.exe does is down, whatever is installed', () => {
  for (const code of ['EVERYTHING_DOWN', 'EVERYTHING_TIMEOUT', 'EVERYTHING_BAD_OUTPUT', 'EVERYTHING_TOO_LARGE']) {
    assert.deepEqual(classifyEverything(code, { installed: true, known: true }), { state: 'down', detail: 'not-running' }, code)
  }
  // 取消没有「哪一环坏了」可说：报 not-running 会让人去查一个没坏的东西。
  assert.deepEqual(classifyEverything('EVERYTHING_ABORTED', { installed: true, known: true }), {
    state: 'down',
    detail: 'unknown',
  })
})

test('probe answers ready with the version es.exe reported and the path it resolved', async () => {
  const result = await probe({ esPath: process.execPath, versionProbe: async () => '1.4.1.1026' })
  assert.deepEqual(result, { state: 'ready', version: '1.4.1.1026', path: process.execPath })
})

test('probe reports a missing es.exe without leaking the hint', async () => {
  const missing = process.platform === 'win32' ? 'C:\\no-such-dir-xyz\\es.exe' : '/no-such-dir-xyz/es.exe'
  const result = await probe({ esPath: missing, presence: () => ({ installed: true, via: 'exe', known: true }) })
  assert.equal(result.state, 'missing-tool')
  assert.equal(result.detail, 'es-missing')
  assert.equal(result.code, 'EVERYTHING_ES_NOT_FOUND')
  assert.match(result.message, /es\.exe/)
  // `EngineError.hint` 不进工具返回，所以也不能从探针里漏出来。
  assert.equal('hint' in result, false)
})

test('probe reports a broken es.exe run as down and keeps a cancellation its own code', async () => {
  const broken = await probe({
    esPath: process.execPath,
    versionProbe: async () => {
      throw new EngineError('Everything version probe returned nothing', 'EVERYTHING_DOWN')
    },
  })
  assert.deepEqual(broken, {
    state: 'down',
    detail: 'not-running',
    code: 'EVERYTHING_DOWN',
    message: 'Everything version probe returned nothing',
  })

  const cancelled = await probe({
    esPath: process.execPath,
    versionProbe: async () => {
      throw new EngineError('Everything search was aborted', 'EVERYTHING_ABORTED')
    },
  })
  assert.deepEqual(cancelled, {
    state: 'down',
    detail: 'unknown',
    code: 'EVERYTHING_ABORTED',
    message: 'Everything search was aborted',
  })
})

test('resolves a hand-written ~ in esPath through the platform home', () => {
  // 页面草稿校验会展开 `~`；工具侧不展开的话，手写 profile 能过校验、每次检索却都找不到文件。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-es-'))
  try {
    const file = join(dir, 'es.exe')
    writeFileSync(file, '')
    const platform = { pathStyle: process.platform === 'win32' ? 'windows' : 'posix', home: dir }
    assert.equal(resolveEsPath({ esPath: '~/es.exe' }, platform), file)
    assert.throws(
      () => resolveEsPath({ esPath: '~/missing.exe' }, platform),
      (error) => error instanceof EngineError && error.code === 'EVERYTHING_ES_NOT_FOUND',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function supportsGbk() {
  try {
    new TextDecoder('gbk')
    return true
  } catch {
    return false
  }
}
