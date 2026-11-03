import test from 'node:test'
import assert from 'node:assert/strict'
import { configFacts, diagnose } from '../lib/diagnose.js'

// 一份「什么都有」的现场。时间戳是注入的固定值：文本构造不读时钟，测试也就没有理由比时间。
const COMPLETE = {
  plugin: '0.4.0',
  dsh: '0.2.1-rc.5',
  shell: 'desktop-app',
  profile: 'desktop',
  remote: 'no',
  os: { platform: 'win32', release: '10.0.19045', node: 'v24.18.1' },
  engines: {
    everything: { state: 'ready', version: '1.4.1.1026', path: 'C:\\Tools\\es.exe' },
    anytxt: {
      state: 'down',
      detail: 'unknown',
      code: 'ANYTXT_DOWN',
      message: 'Anytxt JSON-RPC is unreachable (ECONNREFUSED)',
      url: 'http://127.0.0.1:9920',
      tried: ['http://127.0.0.1:9920', 'http://127.0.0.1:9921'],
    },
  },
  roots: { workspace: 'C:\\Home\\me\\projects', work: '', personal: '', all: ['C:\\', 'D:\\'], default: 'all' },
  config: {
    esPath: '(auto)',
    esEncoding: 'gbk',
    anytxtUrl: 'http://127.0.0.1:9920',
    timeoutMs: 30000,
    checkEnginesOnStart: true,
    maxResults: 20,
    readMaxChars: 8000,
    filesBackend: 'everything',
    contentBackend: 'anytxt',
  },
  autoconfig: { ran: true, deferred: false },
  home: 'C:\\Home\\me',
  dshHome: 'C:\\Home\\dsh',
  checkedAt: '2026-11-01T09:12:44.000Z',
}

test('renders every block of a complete diagnosis, in a fixed order', () => {
  assert.equal(
    diagnose(COMPLETE),
    [
      '# dsh-local-search diagnostics (0.4.0)',
      'dsh 0.2.1-rc.5 (reported by the page)',
      'shell=desktop-app  profile=desktop  remote=no',
      'os=win32 10.0.19045  node=v24.18.1',
      'Everything: OK (1.4.1.1026) via C:\\Tools\\es.exe',
      'Anytxt: DOWN [install not found] — ANYTXT_DOWN: Anytxt JSON-RPC is unreachable (ECONNREFUSED) at http://127.0.0.1:9920 (tried http://127.0.0.1:9920, http://127.0.0.1:9921)',
      'roots: workspace=~/projects  work=(unset)  personal=(unset)  all=C:\\,D:\\  default=all',
      'config: esPath=(auto)  esEncoding=gbk  anytxtUrl=http://127.0.0.1:9920  timeoutMs=30000  checkEnginesOnStart=true  maxResults=20  readMaxChars=8000  filesBackend=everything  contentBackend=anytxt',
      'first-run: ran=true  deferred=false',
      'checked-at: 2026-11-01T09:12:44Z',
      'legend: [not running] = installed but not answering; [es.exe missing] = the command-line tool is absent; [install not found] = not in the usual install folders',
      'docs: https://github.com/fishdivinity/dsh-local-search/blob/main/docs/troubleshooting.md',
    ].join('\n'),
  )
})

test('a failure shows the address it tried and the install evidence', () => {
  const text = diagnose({
    engines: {
      anytxt: {
        state: 'down',
        detail: 'not-running',
        code: 'ANYTXT_DOWN',
        message: 'Anytxt JSON-RPC is unreachable (ECONNREFUSED)',
        url: 'http://127.0.0.1:9920',
      },
    },
  })
  assert.equal(
    text,
    'Anytxt: DOWN [installed, not running] — ANYTXT_DOWN: Anytxt JSON-RPC is unreachable (ECONNREFUSED) at http://127.0.0.1:9920',
  )
})

test('a complete document explains its own tokens and points at the code table', () => {
  const text = diagnose({
    plugin: '0.4.0',
    engines: { anytxt: { state: 'down', detail: 'not-running', code: 'ANYTXT_DOWN', message: 'unreachable' } },
  })
  assert.equal(
    text,
    [
      '# dsh-local-search diagnostics (0.4.0)',
      'Anytxt: DOWN [installed, not running] — ANYTXT_DOWN: unreachable',
      'legend: [not running] = installed but not answering; [es.exe missing] = the command-line tool is absent; [install not found] = not in the usual install folders',
      'docs: https://github.com/fishdivinity/dsh-local-search/blob/main/docs/troubleshooting.md',
    ].join('\n'),
  )
  // 健康时不写 legend：没有要解释的标签。
  const healthy = diagnose({ plugin: '0.4.0', engines: { everything: { state: 'ready', version: '1.4.1', path: 'C:\\es.exe' } } })
  assert.doesNotMatch(healthy, /legend:/)
  assert.match(healthy, /^docs: /m)
})

test('the config line covers every key of the contract', () => {
  const facts = configFacts({
    files: { backend: 'everything', everything: { esPath: '', esEncoding: 'gbk' } },
    content: { backend: 'anytxt', anytxt: { url: 'http://127.0.0.1:9920' } },
    limits: { maxResults: 20, readMaxChars: 8000 },
    timeoutMs: 30000,
    checkEnginesOnStart: true,
  })
  assert.deepEqual(Object.keys(facts), [
    'esPath',
    'esEncoding',
    'anytxtUrl',
    'timeoutMs',
    'checkEnginesOnStart',
    'maxResults',
    'readMaxChars',
    'filesBackend',
    'contentBackend',
  ])
  // 空 esPath 写 (auto)：读的人要知道「试过自动查找」而不是「没配」。
  assert.equal(facts.esPath, '(auto)')
})

test('a first-run error is copied into the text and masked like any path', () => {
  const text = diagnose({
    plugin: '0.4.0',
    home: 'C:\\Home\\me',
    autoconfig: { ran: true, deferred: true, error: 'could not write C:\\Home\\me\\x' },
  })
  assert.match(text, /^first-run: ran=true  deferred=true  error=could not write ~\/x$/m)
})

test('masks a home written with forward slashes, as Windows accepts both', () => {
  // 手写 profile 常把 `C:\Home\me` 写成 `C:/Home/me`；只有反斜杠写法被脱敏，用户名就漏了。
  assert.equal(
    diagnose({ home: 'C:\\Home\\me', os: { platform: 'win32' }, config: { esPath: 'C:/Home/me/bin/es.exe' } }),
    'os=win32\nconfig: esPath=~/bin/es.exe',
  )
  assert.equal(
    diagnose({ home: 'C:/Home/me', os: { platform: 'win32' }, config: { esPath: 'C:\\Home\\me\\bin\\es.exe' } }),
    'os=win32\nconfig: esPath=~/bin\\es.exe',
  )
})

test('the config line is masked like every other path', () => {
  const text = diagnose({
    home: 'C:\\Home\\me',
    config: {
      esPath: 'C:\\Home\\me\\bin\\es.exe',
      anytxtUrl: 'http://127.0.0.1:9920',
      timeoutMs: 30000,
      checkEnginesOnStart: false,
    },
  })
  assert.equal(
    text,
    'config: esPath=~/bin\\es.exe  anytxtUrl=http://127.0.0.1:9920  timeoutMs=30000  checkEnginesOnStart=false',
  )
})

test('drops every block the caller has no fact for', () => {
  assert.equal(diagnose({}), '')
  assert.equal(diagnose(), '')
  // 没有 plugin 就没有第一行，而不是一行空版本。
  assert.equal(diagnose({ dsh: '0.2.1-rc.5' }), 'dsh 0.2.1-rc.5 (reported by the page)')
  // 三个事实各缺各的，缺的那个从行里消失，剩下的照排。
  assert.equal(diagnose({ shell: 'browser' }), 'shell=browser')
  assert.equal(diagnose({ profile: 'web', remote: 'local' }), 'profile=web  remote=local')
  // 平台的三个值同理：只有 release 时不留 `os=` 空壳。
  assert.equal(diagnose({ os: { release: '10.0.19045' } }), 'os=10.0.19045')
  assert.equal(diagnose({ os: { platform: 'linux', node: 'v24.18.1' } }), 'os=linux  node=v24.18.1')
  assert.equal(diagnose({ os: {} }), '')
  // 没探过引擎就没有引擎行，不是两行 DOWN。
  assert.equal(diagnose({ engines: {} }), '')
  assert.equal(diagnose({ autoconfig: {} }), '')
  assert.equal(diagnose({ health: {} }), '')
})

test('never writes a placeholder for a fact it does not have', () => {
  for (const text of [
    diagnose({}),
    diagnose(COMPLETE),
    diagnose({ plugin: '0.4.0', roots: {} }),
    diagnose({ engines: { anytxt: { state: 'down' } } }),
  ]) {
    // 缺的字段整段不出现；`[unknown]` 是探测的细分类，不是占位符。
    assert.doesNotMatch(text, /=unknown\b/i)
    assert.doesNotMatch(text, /\bunknown=/i)
  }
})

test('masks the home prefix and keeps the rest of the path as typed', () => {
  assert.equal(
    diagnose({ home: 'C:\\Home\\me', roots: { workspace: 'C:\\Home\\me\\doc', all: ['C:\\Home\\me\\a', 'D:\\beta'] } }),
    'roots: workspace=~/doc  work=(unset)  personal=(unset)  all=~/a,D:\\beta',
  )
  // 整好等于 home 的根换成 `~`。
  assert.equal(
    diagnose({ home: 'C:\\Home\\me', roots: { workspace: 'C:\\Home\\me' } }),
    'roots: workspace=~  work=(unset)  personal=(unset)  all=(unset)',
  )
})

test('masks DSH_HOME before home, so the longer prefix wins', () => {
  const home = 'C:\\Home\\me'
  const dshHome = 'C:\\Home\\me\\dsh'
  assert.equal(
    diagnose({ home, dshHome, engines: { everything: { state: 'ready', path: 'C:\\Home\\me\\dsh\\bin\\es.exe' } } }),
    'Everything: OK via ~/bin\\es.exe',
  )
})

test('masking respects path boundaries', () => {
  // `C:\Home\me2` 是另一个用户：吃掉它的前缀会把别人的目录说成自己的 ~。
  assert.equal(
    diagnose({ home: 'C:\\Home\\me', roots: { workspace: 'C:\\Home\\me2\\doc' } }),
    'roots: workspace=C:\\Home\\me2\\doc  work=(unset)  personal=(unset)  all=(unset)',
  )
  // Windows 路径不区分大小写，配置里的大小写可能和 os.homedir() 不同。
  assert.equal(
    diagnose({ home: 'C:\\Home\\me', os: { platform: 'win32' }, roots: { workspace: 'c:\\home\\ME\\doc' } }),
    ['os=win32', 'roots: workspace=~/doc  work=(unset)  personal=(unset)  all=(unset)'].join('\n'),
  )
})

test('masks paths that arrive inside an engine message', () => {
  assert.equal(
    diagnose({
      home: 'C:\\Home\\me',
      engines: {
        everything: {
          state: 'missing-tool',
          code: 'EVERYTHING_ES_NOT_FOUND',
          message: 'es.exe not found at C:\\Home\\me\\Tools\\es.exe',
        },
      },
    }),
    'Everything: MISSING-TOOL — EVERYTHING_ES_NOT_FOUND: es.exe not found at ~/Tools\\es.exe',
  )
})

test('the pasted text carries no user name', () => {
  const text = diagnose(COMPLETE)
  assert.doesNotMatch(text, /Home/)
  assert.doesNotMatch(text, /\\me\b/)
})

test('names the missing link for a tool and for an index', () => {
  assert.equal(
    diagnose({
      engines: {
        everything: { state: 'missing-tool', code: 'EVERYTHING_ES_NOT_FOUND', message: 'es.exe was not found' },
        anytxt: { state: 'missing-index', code: 'ANYTXT_DOWN' },
      },
    }),
    [
      'Everything: MISSING-TOOL — EVERYTHING_ES_NOT_FOUND: es.exe was not found',
      'Anytxt: MISSING-INDEX — ANYTXT_DOWN',
    ].join('\n'),
  )
})

test('a skipped or cancelled probe is not read as DOWN', () => {
  const text = diagnose({
    engines: {
      everything: { ok: false, code: 'SKIPPED', message: 'not checked because engine=anytxt' },
      anytxt: { state: 'down', code: 'ANYTXT_ABORTED', message: 'Anytxt request was aborted' },
    },
  })
  assert.equal(
    text,
    ['Everything: SKIPPED — not checked because engine=anytxt', 'Anytxt: ABORTED — ANYTXT_ABORTED'].join('\n'),
  )
  assert.doesNotMatch(text, /DOWN/)
})

test('accepts the ok-shaped probe result the status route still produces', () => {
  assert.equal(
    diagnose({ engines: { everything: { ok: true, version: '1.4.1.1030', path: 'D:\\es.exe' } } }),
    'Everything: OK (1.4.1.1030) via D:\\es.exe',
  )
  assert.equal(
    diagnose({ engines: { anytxt: { ok: true, url: 'http://127.0.0.1:9920' } } }),
    'Anytxt: OK at http://127.0.0.1:9920',
  )
})

test('writes (unset) for empty scopes and an empty all list', () => {
  assert.equal(diagnose({ roots: {} }), 'roots: workspace=(unset)  work=(unset)  personal=(unset)  all=(unset)')
  assert.equal(
    diagnose({ roots: { workspace: '  ', work: 'D:\\Projects', all: [] } }),
    'roots: workspace=(unset)  work=D:\\Projects  personal=(unset)  all=(unset)',
  )
})

test('reports when the probe ran', () => {
  assert.equal(diagnose({ checkedAt: '2026-11-01T09:12:44.000Z' }), 'checked-at: 2026-11-01T09:12:44Z')
})

test('timestamps are second-precision UTC', () => {
  assert.equal(diagnose({ checkedAt: '2026-11-01T09:12:44.987Z' }), 'checked-at: 2026-11-01T09:12:44Z')
  assert.equal(diagnose({ checkedAt: '2026-11-01T09:12:44.123+08:00' }), 'checked-at: 2026-11-01T01:12:44Z')
  assert.equal(diagnose({ checkedAt: 'not-a-date' }), '')
})
