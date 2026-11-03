import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describeConfig } from '../lib/describe.js'
import { DESCRIBE_ROUTE, DIAGNOSE_ROUTE, DRAFT_PARAM, STATUS_ROUTE } from '../lib/route.js'
import { isLoopbackUrl } from '../lib/config.js'
import { normalizePath as hostNormalizePath, normalizePaths as hostNormalizePaths } from '../lib/platform.js'

const clientUrl = new URL('../lib/client.js', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)
const patchUrl = new URL('../cordis.patch.yml', import.meta.url)
const source = readFileSync(clientUrl, 'utf8')
const manifest = JSON.parse(readFileSync(packageUrl, 'utf8'))
const patch = readFileSync(patchUrl, 'utf8')

/**
 * 像客户端模块系统那样加载发布出去的 bundle：普通脚本 + 打桩的 `require`。
 * @param options - `buttonAsForwardRef` 复刻真实 primitives（`Button` 是 `forwardRef(...)`，
 * 因此是对象而不是函数）；`omit` 去掉一个 primitive，模拟更旧的部署；
 * `primitivesModule: false` 让宿主干脆没暴露这个包（`require` 抛异常）；
 * `hooks` 换掉默认的静态 hooks，用一套会真的重渲染的实现
 */
function loadBundle(options = {}) {
  let definition
  const window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  new Function('window', source)(window)
  const component = () => null
  // 每个 primitive 一个独立函数：测试用 `node.type === stubs[...].X` 找控件，共用同一个函数就分不清。
  const primitive = () => () => null
  const calls = []
  const primitives = {
    // 真实的 Button 是 forwardRef 的返回值：对象，不是函数。
    Button: options.buttonAsForwardRef === true
      ? { $$typeof: Symbol.for('react.forward_ref'), render: component }
      : primitive(),
    Modal: primitive(),
    SegmentedControl: primitive(),
    SettingsForm: primitive(),
    SettingsValueField: primitive(),
    Switch: primitive(),
    Tag: primitive(),
  }
  if (options.omit !== undefined) delete primitives[options.omit]
  const stubs = {
    react: options.hooks ?? {
      createElement: (type, props, ...children) => {
        calls.push({ type, props, children })
        return { type, props, children }
      },
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      // 不执行副作用：页面里的 describe 请求留给浏览器，测试只关心它渲染出什么。
      useEffect: () => undefined,
    },
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  if (options.primitivesModule === false) delete stubs['@deepseek-ai/dsh-client-ui-primitives']
  const mod = definition.factory((spec) => {
    if (!(spec in stubs)) throw new Error(`unexpected require: ${spec}`)
    return stubs[spec]
  })
  return { definition, mod, stubs, calls }
}

/**
 * 一套会真的重渲染的最小 hooks。
 *
 * 静态的 `useState` 桩看不见「effect 把状态改掉、依赖数组又含那个状态」这类死锁，而这个页面
 * 恰恰在 describe 请求上踩过一次：状态一改就触发 cleanup，请求的回答被丢掉，页面永远停在
 * 「正在读取后端列表…」。所以这里要有真状态、真依赖比较、真 cleanup。
 */
function liveHooks() {
  const slots = []
  const ran = new Map()
  let cursor = 0
  let queued = []
  let dirty = false

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++
      if (slots[index] === undefined) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[index]
      return [slot.value, (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (value === slot.value) return
        slot.value = value
        dirty = true
      }]
    },
    useEffect(fn, deps) {
      queued.push({ index: cursor++, fn, deps })
    },
  }

  return {
    react,
    /** 一帧的开始：重置 hooks 游标与待运行副作用。 */
    begin() {
      cursor = 0
      queued = []
    },
    /** 一帧的结束：按依赖比较决定哪些 effect 要重跑（先跑上一轮的 cleanup）。 */
    end() {
      for (const { index, fn, deps } of queued) {
        const previous = ran.get(index)
        const changed = previous === undefined
          || deps === undefined
          || previous.deps === undefined
          || deps.length !== previous.deps.length
          || deps.some((value, at) => value !== previous.deps[at])
        if (!changed) continue
        previous?.cleanup?.()
        ran.set(index, { deps, cleanup: fn() })
      }
    },
    /** 自上一帧以来有没有状态变化。 */
    takeDirty() {
      const value = dirty
      dirty = false
      return value
    },
  }
}

/** 把渲染树里的文字摊平（页面把 children 当 prop 传，所以两边都要看）。 */
function flatText(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(flatText).join('')
  return `${flatText(tree.props?.children)}${flatText(tree.children)}`
}

/** 一个元素的文字（按钮的标签就是这么取：children 是字符串或数组两种都有）。 */
function labelOf(node) {
  const children = node?.children
  return Array.isArray(children) ? children.join('') : String(children ?? '')
}

/** 换掉 `fetch` 跑一段，跑完原样还回去——每个用例都写 try/finally 只会遮住断言。 */
async function withFetch(handler, run) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

/**
 * 临时改写几个全局事实（`location` / `navigator` / `__DSH_BOOT__`），跑完连描述符一起还原。
 *
 * 页面只从 `globalThis` 上读它们（`remoteOf` / `dshVersion` / `copyDiagnose`），所以在 Node 里
 * 打桩就能复现「Host 在另一台机器上 / 剪贴板被拒 / 有或没有 DSH 版本」这几种现场，不需要真浏览器。
 * @param values - 全局名到临时值
 * @param run - 在打桩期间执行的函数
 */
async function withGlobals(values, run) {
  const saved = new Map()
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, writable: true, value })
  }
  try {
    return await run()
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
  }
}

/** describe 给页面的平台描述：路径改写与文案都按它分叉。 */
const WINDOWS = { os: 'win32', pathStyle: 'windows' }
const POSIX = { os: 'linux', pathStyle: 'posix' }

/**
 * 把排队的 promise 链跑完。
 *
 * 用假定时器推进启动检查时不能用 `setTimeout` 等（它被换成了假时钟），`setImmediate` 不在被替换
 * 的 API 里，正好用来清空微任务队列。
 */
async function settleMicrotasks() {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

/**
 * 用会真的重渲染的 hooks 挂载配置页，并按 React 的提交顺序推进帧。
 *
 * 顺序是这个 bug 的关键：状态更新会在**网络回答到达之前**就被渲染成帧，cleanup 与下一次
 * effect 都在那一帧里跑；先等网络再渲染的驱动器会让两版代码都「通过」，等于测不出东西。
 * @param mod - 加载好的 bundle 导出
 * @param hooks - {@link liveHooks} 的返回值
 */
function mountPage(mod, hooks, form = { state: { value: {}, user: {}, writable: true }, mutate: async () => true }) {
  let current
  const render = () => {
    hooks.begin()
    current = mod.ConfigPage({ t: (key) => key, form, view: 'page' })
    hooks.end()
  }
  return {
    render,
    tree: () => current,
    /**
     * 推进若干帧，直到 `done()` 成立或再没有待提交的状态更新。
     * @param done - 判断页面已经到位的谓词
     * @param frames - 最多推进几帧
     */
    async settle(done, frames = 6) {
      for (let frame = 0; frame < frames; frame += 1) {
        if (hooks.takeDirty()) render()
        if (done()) return
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (hooks.takeDirty()) render()
    },
  }
}

/** 当前帧里那些 Section 元素的小节标题键。 */
function sectionTitles(tree) {
  return (tree?.props?.children ?? [])
    .filter((child) => child !== null && child !== undefined && typeof child.props?.title === 'string')
    .map((child) => child.props.title)
}

/**
 * 在渲染树里收集所有满足条件的元素。
 *
 * `children` 走一遍，props 里挂的子树也要走：`Section` 的选择器与页脚、`Modal` 的页脚都是当 prop
 * 传进去的，只走 `children` 会漏掉它们。只认带 `type` 的节点，样式对象之类的普通对象直接跳过。
 */
function collectElements(tree, predicate, found = []) {
  if (tree === null || tree === undefined) return found
  if (Array.isArray(tree)) {
    for (const child of tree) collectElements(child, predicate, found)
    return found
  }
  if (typeof tree !== 'object' || tree.type === undefined) return found
  if (predicate(tree)) found.push(tree)
  collectElements(tree.children, predicate, found)
  for (const value of Object.values(tree.props ?? {})) {
    if (value !== null && typeof value === 'object') collectElements(value, predicate, found)
  }
  return found
}

/** 在渲染树里找第一个满足条件的元素（`children` 与 `props.children` 都走）。 */
function findElement(tree, predicate) {
  return collectElements(tree, predicate)[0]
}

/** 当前开着的那个 `Modal` 元素（弹窗是页面自己渲染的子元素，props 里带着标题与页脚）。 */
function openModal(tree, stubs) {
  return findElement(tree, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Modal)
}

/** 弹窗页脚里文字正好是 `label` 的那个按钮。 */
function modalButton(modal, label) {
  const footer = modal?.props?.footer ?? []
  return footer.find((node) => (Array.isArray(node.children) ? node.children.join('') : String(node.children)) === label)
}

/** 按路径键找字段原件：页面给每个字段的 id 是 `plugin-config-local-search-<键>`。 */
function fieldNode(tree, key) {
  return findElement(tree, (node) => node.props?.id === `plugin-config-local-search-${key}`)
}

/** 包着这个字段的格子：失焦钩子挂在它上面（原件没有 onBlur 入参）。 */
function fieldCell(tree, key) {
  return findElement(tree, (node) => typeof node.props?.onBlur === 'function'
    && findElement(node, (child) => child.props?.id === `plugin-config-local-search-${key}`) !== undefined)
}

/** 交替渲染几帧，让异步的状态更新落地。 */
async function pump(hooks, render, frames = 4) {
  for (let frame = 0; frame < frames; frame += 1) {
    if (hooks.takeDirty()) render()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * 一个记录浏览器半边注册了什么、并收集清理函数的插件上下文。
 *
 * `slots.inject` 必须**真的**调那个 `register`：提示卡就是走这条路的，直接抛异常会让
 * 「有失败时挂了一张卡」变成不可测。真实壳子缺槽位时由 `show()` 自己的 `try/catch` 兜住。
 */
function fakeContext() {
  const registrations = []
  const disposers = []
  return {
    registrations,
    /** 某个槽位上注册过的组件（提示卡用它）。 */
    registered(name) {
      return registrations.filter((entry) => entry.kind === 'slot' && entry.name === name)
    },
    disposeAll() {
      while (disposers.length > 0) disposers.pop()()
    },
    ctx: {
      effect: (fn) => {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      slots: {
        inject: (name, register) => register(),
        register: (options, component) => {
          // 留下 `disposed`：提示卡「修好以后静默撤卡」是靠这个 disposer 撤的，测试要看得见。
          const entry = { kind: 'slot', name: options.name, options, component, disposed: false }
          registrations.push(entry)
          return () => { entry.disposed = true }
        },
      },
      locale: {
        bind: () => (key) => key,
        register: (namespace, dictionary) => {
          registrations.push({ kind: 'locale', namespace, dictionary })
          return () => {}
        },
      },
    },
  }
}

test('the bundle registers the package name in the lazy-CJS factory format', () => {
  const { definition, mod } = loadBundle()
  assert.equal(definition.id, manifest.name)
  assert.deepEqual(mod.inject, ['slots', 'locale'])
  assert.equal(typeof mod.apply, 'function')
  assert.ok(!/^\s*(import|export)\s/m.test(source), 'a classic script cannot carry ESM syntax')
})

test('apply registers one configuration card in the Plugins page official group', () => {
  const { mod } = loadBundle()
  const { ctx, registrations, disposeAll } = fakeContext()
  mod.apply(ctx)
  disposeAll()

  const slots = registrations.filter((entry) => entry.kind === 'slot')
  assert.equal(slots.length, 1, 'one configuration surface, no duplicate page')
  const slot = slots[0]
  // dsh-github 用同样的方式贡献它的 GitHub 卡片。
  assert.equal(slot.name, 'plugins.item')
  // 页面用这个 id 取表单，而只有设置命名空间能答；所以它必须是 bundle patch 声明的行 id，
  // 不是包名。
  assert.equal(slot.options.id, mod.ITEM_ID)
  assert.equal(slot.options.id, 'fishdivinity-local-search')
  assert.notEqual(slot.options.id, manifest.name)
  assert.match(patch, /id: fishdivinity-local-search/)
  assert.equal(typeof slot.options.label, 'function')
  assert.equal(slot.options.locale, mod.NS)
  assert.equal(typeof slot.component, 'function')
})

test('the page renders the form even though Button is a forwardRef object', () => {
  // 回归：`typeof primitive === 'function'` 的就绪判断在每个部署上都会失败，因为发布出去的
  // `Button` 是 forwardRef 对象，页面于是退回到「没有提供设置命名空间」那一行。
  const { mod, stubs } = loadBundle({ buttonAsForwardRef: true })
  const form = { state: { value: {}, user: {}, writable: true }, mutate: async () => true }
  const tree = mod.ConfigPage({ t: (key) => key, form, view: 'page' })
  assert.equal(tree.type, stubs['@deepseek-ai/dsh-client-ui-primitives'].SettingsForm)
})

test('the client manifest asks for services, not for the primitives module', () => {
  // inject 里每一个名字都是宿主得有的**包**：模块系统按它排激活顺序，名字没有对应行就跳过，
  // 不会因此丢掉这半边。primitives 走宿主模块表里的静态种子（`dsh-github` 连声明都没有），
  // 声明它只多一条需要维护的名字。
  const injected = manifest.dsh.client.inject
  assert.deepEqual(injected, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ])
  assert.ok(!injected.includes('@deepseek-ai/dsh-client-ui-primitives'))
})

test('a host that never exposed the primitives module shows a line instead of throwing', () => {
  // 部署的模块表里没有 primitives（0.2.x 早期不把它当独立模块给客户端）：`require` 抛异常会
  // 让这半边连卡片带服务一起消失。降级成一行说明，工具与 profile 里的配置仍然可用；原因进一条 warn。
  const warnings = []
  const original = console.warn
  console.warn = (message) => { warnings.push(String(message)) }
  let mod
  try {
    ({ mod } = loadBundle({ primitivesModule: false }))
  } finally {
    console.warn = original
  }
  const form = { state: { value: {}, user: {}, writable: true }, mutate: async () => true }
  const tree = mod.ConfigPage({ t: (key) => key, form, view: 'page' })
  assert.equal(tree.type, 'p')
  assert.equal(tree.props.role, 'status')
  assert.equal(flatText(tree), 'deploy.primitivesMissing')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /dsh-local-search/)
})

test('the page leaves the loading line once the description arrives', async () => {
  // 回归：describe 请求曾经自己把状态改成 loading，而那个状态又在依赖数组里。React 先提交
  // 那一帧、跑掉 cleanup（把本次请求的 live 置 false），再跑一次已经被守卫挡住的 effect，
  // 于是网络回答回来时被丢掉，页面永远停在「正在读取后端列表…」。
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => describeConfig() })
  try {
    const page = mountPage(mod, hooks)
    page.render()
    assert.match(flatText(page.tree()), /describe\.loading/, 'the first frame asks the reader to wait')
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    // 五个小节：能力两节 + 范围 / 上限 / 启动；标题键是点号分段的语言包键。
    assert.deepEqual(sectionTitles(page.tree()), [
      'section.files',
      'section.content',
      'section.scopes',
      'section.limits',
      'section.startup',
    ])
    assert.ok(!flatText(page.tree()).includes('describe.loading'))
  } finally {
    globalThis.fetch = original
  }
})

test('every control carries the name a browser needs before it stays quiet', async () => {
  // 浏览器的表单标签检查只认三样：`<label for>` 指向的 id、控件自己的 aria-label 源头、id 的唯一性。
  // 原件只负责画（`SettingsValueField` → `<label for=id>` + `<input id>`；`SegmentedControl` →
  // `aria-label` 与按 id 拼出来的 DOM id），值全由页面给，所以这里钉住页面这一侧。
  //
  // 只数得到页面直接渲染的那些：`ChoiceField` 里的分段控件要等 React 展开这个函数组件才出现，
  // 桩不会展开它，所以计数是 8 个文本框 + 2 个后端选择器。
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => describeConfig() })
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    const primitives = stubs['@deepseek-ai/dsh-client-ui-primitives']
    const controls = [
      ...collectElements(page.tree(), (node) => node.type === primitives.SettingsValueField),
      ...collectElements(page.tree(), (node) => node.type === primitives.SegmentedControl),
    ]
    assert.equal(controls.length, 10)
    const ids = controls.map((node) => node.props.id)
    for (const id of ids) {
      assert.equal(typeof id, 'string', 'a control without an id is a control no label can point at')
      assert.match(id, /^plugin-config-local-search-/)
    }
    assert.equal(new Set(ids).size, ids.length, 'two controls must not share an id')
    for (const node of controls) {
      assert.equal(typeof node.props.label, 'string')
      assert.notEqual(node.props.label, '', 'an empty label is the same as no label')
    }
  } finally {
    globalThis.fetch = original
  }
})

test('a failed startup write is shown on the page, not only in the log', async () => {
  // 回归：`autoconfig.error` 一直没进 describe，写回失败只落一条用户不会去看的日志。
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => describeConfig({
      autoconfig: { pending: false, ran: true, error: 'SETTINGS_CONFLICT: the namespace is locked' },
    }),
  })
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    const notice = findElement(page.tree(), (node) => node.props?.role === 'alert')
    assert.ok(notice !== undefined, 'the failure must be visible on the page')
    assert.match(flatText(notice), /autoconfig\.failed/)
    assert.match(flatText(notice), /SETTINGS_CONFLICT/)
  } finally {
    globalThis.fetch = original
  }
})

test('a failed description fetch shows the reason from the body, not just the status', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ ok: false, code: 'PROBE_FAILED', message: 'settle failed' }),
  })
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => flatText(page.tree()).includes('describe.failed'))
    const text = flatText(page.tree())
    assert.ok(text.includes('describe.failed'), `expected the failure line, got: ${text.slice(0, 160)}`)
    assert.ok(text.includes('settle failed'))
    assert.ok(text.includes('action.retry'))
  } finally {
    globalThis.fetch = original
  }
})

test('the save gate asks the Host only about the drafts it can check safely', () => {
  const { mod } = loadBundle()
  const fields = new Map([
    ['content.anytxt.url', { probeEndpoint: true }],
    ['files.everything.esPath', { verifyPath: true }],
    ['scopes.allRoots', { verifyDir: true }],
    ['limits.maxResults', { type: 'count', max: 100 }],
  ])
  const query = mod.internals.verifyQuery({
    'content.anytxt.url': { op: 'set', text: 'http://127.0.0.1:9921' },
    'files.everything.esPath': { op: 'set', text: 'C:/es.exe' },
    'scopes.allRoots': { op: 'set', text: 'D:/Alpha; E:\\Beta ;' },
    'limits.maxResults': { op: 'set', text: '50', numeric: true },
  }, fields)
  const params = new URLSearchParams(query)
  assert.equal(params.get(mod.DRAFT_PARAM), 'http://127.0.0.1:9921')
  // 查询串里的路径已经是标准写法：改写与发请求不分两步，免得哪天只改了一边。
  assert.equal(params.get(mod.DRAFT_PATH_PARAM), 'C:\\es.exe')
  // 分号列表拆成多条 dir，空项丢掉。
  assert.deepEqual(params.getAll(mod.DRAFT_DIR_PARAM), ['D:\\Alpha', 'E:\\Beta'])
  // 整数上限不需要 Host 校验，别把它塞进查询串。
  assert.ok(!query.includes('maxResults'))
  // 没有可校验字段时保存不该先发一次请求。
  assert.equal(mod.internals.verifyQuery({ 'limits.maxResults': { op: 'set', text: '50', numeric: true } }, fields), '')
  // 清空的动作不用校验：它是回落到继承值，不是写一个新值。
  assert.equal(mod.internals.verifyQuery({ 'scopes.allRoots': { op: 'unset', text: '' } }, fields), '')
})

test('a failing save check asks in a dialog before writing anyway', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let mutations = 0
  const checks = []
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    checks.push(target)
    // HTTP 通、但探测本身不通过：这才是「引擎不可用」，不是「请求失败」。
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: false, everything: { ok: true }, anytxt: { ok: false, code: 'ANYTXT_DOWN' } }),
    }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => { mutations += 1; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const endpoint = fieldNode(page.tree(), 'content.anytxt.url')
    assert.ok(endpoint !== undefined, 'the endpoint field must be on the page')
    endpoint.props.onEdit('http://127.0.0.1:9999')
    await pump(hooks, page.render)

    // 第一次按保存：校验失败，不写，改由弹窗问一次。
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.equal(checks.length, 1)
    assert.equal(mutations, 0, 'a failing check must not write')
    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'the failed check must ask through a dialog')
    assert.equal(modal.props.title, 'dialog.saveAnyway.title')
    assert.match(modal.props.description, /error\.engineDown/)
    // 保存按钮不改字：弹窗里的「仍然保存」才是那个第二下。
    assert.equal(page.tree().props.labels.save, 'action.save')

    // 弹窗里选「仍然保存」：用户已经知道引擎不可用，按他说的写。
    modalButton(modal, 'action.saveAnyway').props.onClick()
    await pump(hooks, page.render)
    assert.equal(mutations, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a rejected draft gets a dialog without a force-save way out', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let mutations = 0
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    // 400：路径上没有文件。这类值没有「稍后会好」的可能，强行写进去只会让配置坏掉。
    return { ok: false, status: 400, json: async () => ({ ok: false, code: 'ES_PATH_REJECTED' }) }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => { mutations += 1; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const esPath = fieldNode(page.tree(), 'files.everything.esPath')
    assert.ok(esPath !== undefined, 'the es.exe path field must be on the page')
    esPath.props.onEdit('C:/nope/es.exe')
    await pump(hooks, page.render)

    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.equal(mutations, 0)
    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'a rejected draft must be explained in a dialog')
    // 硬错是「没法保存」+ 原因，不是页内那句「…，没有写入。」。
    assert.equal(modal.props.title, 'dialog.blocked.title')
    // 句号来自字典（英文是 "."），不写死在模板里。
    assert.equal(modal.props.description, 'error.pathMissingpunct.fullStop')
    assert.equal(modalButton(modal, 'action.saveAnyway'), undefined, 'a hard error must not offer a force save')
    // 再按保存也不会写：结论没变。
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.equal(mutations, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('without Modal the page falls back to the in-page confirmation', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react, omit: 'Modal' })
  const originalFetch = globalThis.fetch
  let mutations = 0
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: false, everything: { ok: true }, anytxt: { ok: false, code: 'ANYTXT_DOWN' } }),
    }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => { mutations += 1; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const endpoint = fieldNode(page.tree(), 'content.anytxt.url')
    endpoint.props.onEdit('http://127.0.0.1:9999')
    await pump(hooks, page.render)

    // 没有弹窗就还是老样子：一行红字，保存按钮变成「仍然保存」。
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.equal(mutations, 0)
    assert.match(flatText(page.tree()), /error\.engineDown/)
    assert.equal(page.tree().props.labels.save, 'action.saveAnyway')
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.equal(mutations, 1)

    // 重置也还是「点两下」：第一下换成确认按钮，第二下才写。
    const resetEntry = () => findElement(page.tree(), (node) => node.type !== undefined
      && Array.isArray(node.children) && node.children.join('') === 'action.reset')
    resetEntry().props.onClick()
    await pump(hooks, page.render)
    assert.equal(mutations, 1, 'the first press only asks')
    const confirm = () => findElement(page.tree(), (node) => Array.isArray(node.children) && node.children.join('') === 'action.resetConfirm')
    assert.ok(confirm() !== undefined, 'the button must ask again')
    confirm().props.onClick()
    await pump(hooks, page.render)
    assert.equal(mutations, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a primitive missing from an older deployment falls back instead of throwing', () => {
  const { mod } = loadBundle({ omit: 'SegmentedControl' })
  const tree = mod.ConfigPage({ t: (key) => key, form: { state: { value: {}, user: {} } }, view: 'page' })
  assert.equal(tree.type, 'p')
  assert.equal(flatText(tree), 'deploy.primitivesMissing')
})

test('fields carry no badge or per-field reset; one reset row serves the whole table', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => describeConfig() })
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => true })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const fields = []
    const buttons = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node !== 'object') return
      if (typeof node.props?.id === 'string' && node.props.id.startsWith('plugin-config-local-search-')) fields.push(node)
      if (node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button) buttons.push(node)
      walk(node.children)
      walk(node.props?.children)
    }
    walk(page.tree())

    assert.ok(fields.length > 0, 'the page must render fields')
    for (const field of fields) {
      assert.ok(!('onReset' in field.props), `${field.props.id} must not carry a per-field reset`)
      assert.notEqual(field.props.overridden, true, `${field.props.id} must not carry the badge`)
    }
    const labels = buttons.map(labelOf)
    // 只剩一个入口：描述正下方那个实心按钮；诊断是另一个动词，不算重置。
    assert.deepEqual(labels.filter((label) => label === 'action.reset'), ['action.reset'])
    const resetButtons = buttons.filter((button) => labelOf(button) === 'action.reset')
    assert.deepEqual(resetButtons.map((button) => button.props.variant), ['primary'])
    const topLevel = page.tree().props.children
    // 入口和诊断按钮同一行，行内顺序固定：先重置，后诊断。
    assert.equal(topLevel[0].props.key, 'actions')
    assert.deepEqual(topLevel[0].children.map(labelOf), ['action.reset', 'diagnose.copy'])
    // 字段里没有第二个重置入口。
    for (const cell of collectElements(page.tree(), (node) => typeof node.props?.onBlur === 'function')) {
      assert.equal(findElement(cell, (node) => labelOf(node) === 'action.reset'), undefined)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the reset button asks in a dialog, then writes one atomic re-setup', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  const writes = []
  const probed = {
    ok: true,
    everything: { ok: true, path: 'C:/Program Files/Everything/es.exe' },
    anytxt: { ok: true, url: 'http://127.0.0.1:9921' },
  }
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    return { ok: true, status: 200, json: async () => probed }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async (ops) => { writes.push(ops); return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const resetButton = () => findElement(page.tree(), (node) => node.type !== undefined
      && Array.isArray(node.children) && node.children.join('') === 'action.reset')

    assert.ok(resetButton() !== undefined, 'the reset entry must be on the page')
    resetButton().props.onClick()
    await pump(hooks, page.render)
    // 先问一次：没写，弹窗里说清会清什么。
    assert.equal(writes.length, 0)
    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'the reset must confirm in a dialog')
    assert.equal(modal.props.title, 'dialog.reset.title')
    assert.equal(modal.props.description, 'dialog.reset.hint')
    // 标题与确认按钮都是「重置」：弹窗里没有第二遍「确认重置」这种重复。
    assert.ok(modalButton(modal, 'action.cancel') !== undefined, 'the dialog can be cancelled')
    modalButton(modal, 'action.reset').props.onClick()
    await pump(hooks, page.render)

    assert.equal(writes.length, 1)
    const ops = writes[0]
    const { clear, fills, marker } = describeConfig().reset
    assert.deepEqual(ops.slice(0, clear.length), clear.map((path) => ({ op: 'unset', path })))
    // 探测到的两处都被填回去（9921 与默认不同，需要写）。
    assert.deepEqual(ops.slice(clear.length, ops.length - 1), [
      { op: 'set', path: fills[0].path, value: probed.everything.path },
      { op: 'set', path: fills[1].path, value: probed.anytxt.url },
    ])
    assert.deepEqual(ops.at(-1), { op: 'set', path: marker, value: true })
    assert.match(flatText(page.tree()), /reset\.done/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the test connection result lives in a dialog that can probe again', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let probes = 0
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    probes += 1
    return { ok: true, status: 200, json: async () => ({ ok: true, everything: { ok: true, version: '1.5.0' }, anytxt: { ok: true } }) }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => true })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    // 测试控件挂在内容节的页脚（`Section` 在这里只是个元素，页脚是 prop，不会出现在 children 里）。
    const content = findElement(page.tree(), (node) => node.props?.title === 'section.content')
    const testButton = findElement(content.props.footer, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
    assert.ok(testButton !== undefined, 'the test control must be on the page')
    testButton.props.onClick()
    await pump(hooks, page.render)

    assert.equal(probes, 1)
    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'the result must open in a dialog')
    assert.equal(modal.props.title, 'action.test')
    // 正文就是一个两行的无序列表：一行一个引擎，没有地址行、没有说明段。
    assert.equal(modal.props.description, undefined)
    const list = findElement(modal.props.children, (node) => node.type === 'ul')
    assert.ok(list !== undefined, 'the result must be a list')
    // 壳子给 `.body` 固定加 20px 上边距；没有 description 时用负边距拉回去，标题下不留空档。
    assert.equal(modal.props.children.props.style.marginTop, '-20px')
    assert.match(flatText(list), /status\.everything\.ok · 1\.5\.0/)
    assert.match(flatText(list), /status\.anytxt\.ok/)
    // 结论只出现一次：弹窗之外不再留一份页内结果。
    assert.equal((flatText(page.tree()).match(/status\.everything\.ok/g) ?? []).length, 1)

    modalButton(modal, 'action.testAgain').props.onClick()
    await pump(hooks, page.render)
    assert.equal(probes, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('path drafts are rewritten with the path style the Host reports', () => {
  const { mod } = loadBundle()
  const { normalizePath, normalizePaths } = mod.internals
  // Windows 风格：盘符大写、只用 `\`、去掉多余的与末尾的分隔符。
  assert.equal(normalizePath('d:/Alpha/', WINDOWS), 'D:\\Alpha')
  assert.equal(normalizePath('d:\\Alpha\\', WINDOWS), 'D:\\Alpha')
  assert.equal(normalizePath('  C:\\\\Tools\\\\es.exe  ', WINDOWS), 'C:\\Tools\\es.exe')
  // 盘符根只留一个反斜杠：`D:\` 不能变成 `D:`。
  assert.equal(normalizePath('d:/', WINDOWS), 'D:\\')
  assert.equal(normalizePath('\\\\server\\share\\', WINDOWS), '\\\\server\\share')
  assert.equal(normalizePath('//server/share', WINDOWS), '\\\\server\\share')
  // 名字里的空格、中文、带空格的目录名都不动。
  assert.equal(normalizePath('D:\\Alpha\\我的项目\\drawio a', WINDOWS), 'D:\\Alpha\\我的项目\\drawio a')
  // `~` 与 POSIX 写法在 Windows 上也不改：换分隔符只会造出一个不存在的路径。
  assert.equal(normalizePath('~/x', WINDOWS), '~/x')
  assert.equal(normalizePath('/home/me', WINDOWS), '/home/me')
  assert.equal(normalizePath('', WINDOWS), '')
  // POSIX 风格：一切原样，只 trim（`/home/me` 不会被改成 `\home\me`）。
  assert.equal(normalizePath('d:/Alpha/', POSIX), 'd:/Alpha/')
  assert.equal(normalizePath('  /home/me/  ', POSIX), '/home/me/')
  assert.equal(normalizePath('\\\\server\\share\\', POSIX), '\\\\server\\share\\')
  assert.equal(normalizePath('C:\\Tools\\es.exe', POSIX), 'C:\\Tools\\es.exe')
  // 分号列表逐个改写，空项丢掉。
  assert.equal(normalizePaths('d:/a/; e:\\b ;', WINDOWS), 'D:\\a;E:\\b')
  assert.equal(normalizePaths(' /home/a ; /home/b ; ', POSIX), '/home/a;/home/b')
})

test('the page rewrites paths exactly like the Host does', () => {
  // 路径语义在页面与工具两侧各写一遍（浏览器半边不能 import ESM），所以同一组输入必须同答案。
  const { mod } = loadBundle()
  const cases = [
    'd:/Alpha/', 'd:\\Alpha\\', '  C:\\\\Tools\\\\es.exe  ', 'd:/', 'C:', 'c:/',
    '\\\\server\\share\\', '//server/share', '\\\\server',
    'D:\\Alpha\\我的项目\\drawio a', '~/x', '~', '/home/me', '', '   ', 'relative\\dir',
    '/home/a; /home/b ;', 'd:/a/; e:\\b ;',
  ]
  for (const platform of [WINDOWS, POSIX, 'win32', 'linux']) {
    for (const text of cases) {
      assert.equal(mod.internals.normalizePath(text, platform), hostNormalizePath(text, platform),
        `normalizePath(${JSON.stringify(text)}) on ${JSON.stringify(platform)}`)
      assert.equal(mod.internals.normalizePaths(text, platform), hostNormalizePaths(text, platform),
        `normalizePaths(${JSON.stringify(text)}) on ${JSON.stringify(platform)}`)
    }
  }
})

test('normalizeStaged rewrites only what the platform calls a path', () => {
  const { mod } = loadBundle()
  const { normalizeStaged } = mod.internals
  const fields = new Map([
    ['files.everything.esPath', { verifyPath: true }],
    ['scopes.workspaceRoot', { verifyDir: true }],
    ['content.anytxt.url', { probeEndpoint: true }],
  ])
  const staged = {
    'files.everything.esPath': { op: 'set', text: 'c:/tools/es.exe' },
    'scopes.workspaceRoot': { op: 'set', text: 'd:/alpha/' },
    'content.anytxt.url': { op: 'set', text: 'HTTP://127.0.0.1:9920' },
  }
  const windows = normalizeStaged(staged, fields, WINDOWS)
  assert.equal(windows.changed, true)
  assert.equal(windows.next['files.everything.esPath'].text, 'C:\\tools\\es.exe')
  assert.equal(windows.next['scopes.workspaceRoot'].text, 'D:\\alpha')
  // 地址不是路径，一个字符都不动。
  assert.equal(windows.next['content.anytxt.url'].text, 'HTTP://127.0.0.1:9920')
  // POSIX 主机上一项都不改：`changed` 必须是 false，否则保存会多一次没有意义的回写。
  const posixStaged = { ...staged, 'scopes.workspaceRoot': { op: 'set', text: '/home/me' } }
  const posix = normalizeStaged(posixStaged, fields, POSIX)
  assert.equal(posix.changed, false)
  assert.deepEqual(posix.next, posixStaged)
})

test('saving on a POSIX host keeps the paths the user typed', async () => {
  // 回归：页面曾经在浏览器里无条件按 Windows 改写，`/home/me` 被换成 `\home\me` 就指向一个
  // 不存在的目录。平台事实由 describe 给，保存与失焦校验都按它走。
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const asked = []
  let ops
  await withFetch(async (url) => {
    const target = String(url)
    if (target.includes('/describe')) {
      return { ok: true, status: 200, json: async () => describeConfig({ platform: POSIX }) }
    }
    asked.push(target)
    return { ok: true, status: 200, json: async () => ({ ok: true, everything: { ok: true }, anytxt: { ok: true } }) }
  }, async () => {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async (next) => { ops = next; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const edit = (key, text) => fieldNode(page.tree(), key).props.onEdit(text)
    edit('scopes.workspaceRoot', '/home/me')
    edit('scopes.allRoots', '/home/a; /home/b ;')
    edit('files.everything.esPath', '/opt/es/es')
    await pump(hooks, page.render)

    page.tree().props.onSave()
    await pump(hooks, page.render)

    const written = Object.fromEntries((ops ?? []).map((op) => [op.path.join('.'), op.value]))
    assert.equal(written['scopes.workspaceRoot'], '/home/me')
    assert.equal(written['scopes.allRoots'], '/home/a;/home/b')
    assert.equal(written['files.everything.esPath'], '/opt/es/es')
    // 保存前的校验也用同一份平台：查询串里是 `/home/...`，不是 `\home\...`。
    const params = new URLSearchParams(String(asked[0]).split('?')[1])
    assert.deepEqual(params.getAll('dir'), ['/home/me', '/home/a', '/home/b'])
    assert.equal(params.get('esPath'), '/opt/es/es')
  })
})

test('the Host answer is refilled into the draft before it is written', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let ops
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ platform: WINDOWS }) }
    // 磁盘上的真实写法：盘符、目录名的大小写都与输入不同。
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        everything: { ok: true },
        anytxt: { ok: true },
        drafts: { esPath: 'C:\\Tools\\ES.EXE', dirs: ['D:\\Alpha', 'E:\\Beta'] },
      }),
    }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async (next) => { ops = next; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const edit = (key, text) => fieldNode(page.tree(), key).props.onEdit(text)
    edit('files.everything.esPath', 'c:/tools/es.exe')
    edit('scopes.workspaceRoot', 'd:/alpha/')
    edit('scopes.allRoots', 'e:/beta/')
    await pump(hooks, page.render)

    page.tree().props.onSave()
    await pump(hooks, page.render)

    const written = Object.fromEntries((ops ?? []).map((op) => [op.path.join('.'), op.value]))
    assert.equal(written['files.everything.esPath'], 'C:\\Tools\\ES.EXE')
    assert.equal(written['scopes.workspaceRoot'], 'D:\\Alpha')
    assert.equal(written['scopes.allRoots'], 'E:\\Beta')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('saving a path field writes the standard spelling when the Host does not answer with drafts', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let ops
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ platform: WINDOWS }) }
    return { ok: true, status: 200, json: async () => ({ ok: true, everything: { ok: true }, anytxt: { ok: true } }) }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async (next) => { ops = next; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const edit = (key, text) => fieldNode(page.tree(), key).props.onEdit(text)
    edit('files.everything.esPath', 'c:/tools/es.exe')
    edit('scopes.workspaceRoot', 'd:/alpha/')
    edit('scopes.allRoots', 'd:/a/; e:\\b ;')
    await pump(hooks, page.render)

    page.tree().props.onSave()
    await pump(hooks, page.render)

    const written = Object.fromEntries((ops ?? []).map((op) => [op.path.join('.'), op.value]))
    assert.equal(written['files.everything.esPath'], 'C:\\tools\\es.exe')
    assert.equal(written['scopes.workspaceRoot'], 'D:\\alpha')
    assert.equal(written['scopes.allRoots'], 'D:\\a;E:\\b')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the test control sends the es.exe path from the field', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let asked = ''
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ platform: WINDOWS }) }
    asked = target
    // 路径不存在：路由在探测之前就拒了，测试不该拿已保存的那个报「正常」。
    return { ok: false, status: 400, json: async () => ({ ok: false, code: 'ES_PATH_REJECTED' }) }
  }
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    fieldNode(page.tree(), 'files.everything.esPath').props.onEdit('C:/nope/es.exe1')
    await pump(hooks, page.render)

    const content = findElement(page.tree(), (node) => node.props?.title === 'section.content')
    const button = findElement(content.props.footer, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
    button.props.onClick()
    await pump(hooks, page.render)

    const params = new URL(asked, 'http://localhost').searchParams
    assert.equal(params.get(mod.DRAFT_PATH_PARAM), 'C:\\nope\\es.exe1')
    // 单行结论走 description，和别的弹窗正文同一个位置、同一个字号。
    const modal = openModal(page.tree(), stubs)
    assert.equal(modal.props.description, 'error.pathMissingpunct.fullStop')
    assert.equal(modal.props.children, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a path field asks the Host on blur and flags what is missing', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let asked = ''
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ platform: WINDOWS }) }
    asked = target
    return { ok: false, status: 400, json: async () => ({ ok: false, code: 'DIR_REJECTED' }) }
  }
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const id = 'scopes.workspaceRoot'
    const field = () => fieldNode(page.tree(), id)
    field().props.onEdit('C:/nope')
    await pump(hooks, page.render)

    // 原件没有 onBlur：失焦挂在外层那个格子上（focusout 会从输入框冒上来）。
    const cell = fieldCell(page.tree(), id)
    assert.ok(cell !== undefined, 'the field cell must carry the blur hook')
    cell.props.onBlur()
    await pump(hooks, page.render)

    assert.match(asked, /checkOnly=1/, 'the blur check must not spend an es.exe spawn')
    // 发出去的草稿已经是平台的标准写法：`C:/nope` → `C:\nope`。
    assert.equal(new URL(asked, 'http://localhost').searchParams.get(mod.DRAFT_DIR_PARAM), 'C:\\nope')
    assert.equal(field().props.invalid, true)
    assert.equal(field().props.invalidLabel, 'error.invalidDir')

    // 值一改，红字就收回。
    field().props.onEdit('C:/nope2')
    await pump(hooks, page.render)
    assert.equal(field().props.invalid, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the Anytxt address is checked on blur too, without a request', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let asked = 0
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    asked += 1
    return { ok: true, status: 200, json: async () => ({ ok: true, drafts: {} }) }
  }
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const id = 'content.anytxt.url'
    const field = () => fieldNode(page.tree(), id)
    const cell = () => fieldCell(page.tree(), id)

    // 边打字不标红：失焦才判。
    field().props.onEdit('http://example.com:9920')
    await pump(hooks, page.render)
    assert.equal(field().props.invalid, false)

    cell().props.onBlur()
    await pump(hooks, page.render)
    assert.equal(field().props.invalid, true)
    assert.equal(field().props.invalidLabel, 'error.invalidLocal')
    assert.equal(asked, 0, 'a local-address check needs no request')

    // 换回本机地址再失焦，红字收回。
    field().props.onEdit('http://127.0.0.1:9920')
    await pump(hooks, page.render)
    cell().props.onBlur()
    await pump(hooks, page.render)
    assert.equal(field().props.invalid, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a directory field says when the path is actually a file', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ platform: WINDOWS }) }
    return { ok: false, status: 400, json: async () => ({ ok: false, code: 'DIR_NOT_DIRECTORY' }) }
  }
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const id = 'scopes.workspaceRoot'
    const field = () => fieldNode(page.tree(), id)
    const cell = () => fieldCell(page.tree(), id)

    field().props.onEdit('D:\\Alpha\\我的项目\\drawio a')
    await pump(hooks, page.render)
    cell().props.onBlur()
    await pump(hooks, page.render)

    assert.equal(field().props.invalid, true)
    assert.equal(field().props.invalidLabel, 'error.invalidNotDir')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the test control explains a path that is a directory, not a file', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ platform: WINDOWS }) }
    return { ok: false, status: 400, json: async () => ({ ok: false, code: 'ES_PATH_NOT_FILE' }) }
  }
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    fieldNode(page.tree(), 'files.everything.esPath').props.onEdit('C:/Tools')
    await pump(hooks, page.render)

    const content = findElement(page.tree(), (node) => node.props?.title === 'section.content')
    findElement(content.props.footer, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
      .props.onClick()
    await pump(hooks, page.render)

    // 「是个目录」和「不存在」是两种改法，弹窗不能都说「找不到文件」。
    const modal = openModal(page.tree(), stubs)
    assert.equal(modal.props.description, 'error.pathNotFilepunct.fullStop')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('clearing a field stages an unset instead of an empty override', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let ops
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    return { ok: true, status: 200, json: async () => ({ ok: true, everything: { ok: true }, anytxt: { ok: true } }) }
  }
  try {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async (next) => { ops = next; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const field = () => fieldNode(page.tree(), 'files.everything.esPath')
    field().props.onEdit('C:/tools/es.exe')
    await pump(hooks, page.render)
    // 清空：既显示成空串（不把旧值弹回来），也不写一个空覆盖值。
    field().props.onEdit('')
    await pump(hooks, page.render)
    assert.equal(field().props.text, '')

    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.deepEqual(ops, [{ op: 'unset', path: ['files', 'everything', 'esPath'] }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the page uses theme tokens that actually exist', () => {
  const { mod } = loadBundle()
  const { NOTICE_STYLE, LINK_STYLE, gridStyle, GRID_MAX_WIDTH, WIDE_QUERY, CELL_STYLE } = mod.styles
  // 状态色必须用状态 token：品牌色在亮色主题下是近黑，拿它标红等于没标（曾经就写成了不存在的
  // `--dsw-alias-state-warning-primary`，静默回落到普通文字色）。
  assert.match(NOTICE_STYLE.color, /--dsw-alias-state-error-primary/)
  // 红色就够，不加粗。
  assert.equal(NOTICE_STYLE.fontWeight, undefined)
  assert.match(LINK_STYLE.color, /--dsw-alias-link/)
  // 非全屏时只排得下一列，格子必须有上限，否则输入框横贯整屏。
  assert.equal(CELL_STYLE.maxWidth, '560px')

  // 列数由宽度决定，不用 auto-fit：那条路没法同时满足「700px 也两列」与「不要第三列」。
  assert.deepEqual(gridStyle(true).gridTemplateColumns, 'repeat(2, minmax(0, 1fr))')
  assert.deepEqual(gridStyle(false).gridTemplateColumns, 'minmax(0, 1fr)')
  assert.ok(!gridStyle(true).gridTemplateColumns.includes('auto-fit'))
  // 全屏保持原来那个 2×542。
  assert.equal(GRID_MAX_WIDTH, '1100px')
  assert.equal(gridStyle(true).maxWidth, GRID_MAX_WIDTH)
  // 656 = 2 * 320 + 16：两列时每列至少 320px，路径才不至于被挤成省略号。
  assert.equal(WIDE_QUERY, '(min-width: 656px)')
  for (const style of Object.values(mod.styles).filter((value) => typeof value === 'object')) {
    for (const value of Object.values(style)) {
      if (typeof value !== 'string') continue
      assert.ok(!value.includes('state-warning'), 'there is no `state-warning` token')
    }
  }
})

test('both dictionaries carry every key the Host describe asks the page to render', () => {
  const { mod } = loadBundle()
  const keys = new Set()
  for (const section of describeConfig().sections) {
    keys.add(section.titleKey)
    for (const backend of section.backends ?? []) keys.add(backend.labelKey)
    for (const field of section.fields) {
      keys.add(field.labelKey)
      keys.add(field.hintKey)
      for (const choice of field.choices ?? []) keys.add(choice.labelKey)
    }
  }
  // 页面自己说出来的那些键：加载 / 失败 / 保存 / 弹窗 / 探测结果 / 右下角提示卡 / 诊断 / 另一台机器。
  for (const key of [
    'description', 'note', 'item.label', 'describe.loading', 'describe.failed', 'autoconfig.failed', 'action.retry',
    'deploy.unavailable', 'deploy.primitivesMissing', 'deploy.readOnly', 'error.saveFailed', 'action.save', 'action.saving',
    'error.invalidValue', 'error.invalidNumber', 'error.invalidFile', 'error.invalidDir', 'error.invalidNotFile',
    'error.invalidNotDir', 'error.invalidLocal',
    'action.saveAnyway', 'dialog.saveAnyway.title', 'dialog.blocked.title', 'error.engineDown', 'error.noWrite',
    'punct.listSeparator', 'punct.colon', 'punct.fullStop',
    'error.pathMissing', 'error.pathNotFile', 'error.dirMissing', 'error.dirNotDir', 'error.endpointInvalid',
    'action.close', 'action.cancel', 'action.reset', 'action.resetConfirm', 'dialog.reset.title', 'dialog.reset.hint',
    'action.resetting', 'reset.done', 'reset.failed',
    'action.test', 'action.testing', 'action.testAgain', 'test.hint', 'error.testLocalOnly', 'error.testFailed',
    'status.everything.ok', 'status.everything.down', 'status.anytxt.ok', 'status.anytxt.down',
    'fix.download.everything', 'fix.anytxt.notRunning', 'fix.anytxt.unknown', 'fix.anytxt.install',
    'fix.everything.notRunning', 'fix.everything.notInstalled', 'fix.everything.esMissing',
    'notice.title', 'notice.close', 'remote.note',
    'diagnose.copy', 'diagnose.title', 'diagnose.hint', 'diagnose.loading', 'diagnose.error', 'diagnose.copyAction',
    'diagnose.copied', 'diagnose.copyFailed',
  ]) keys.add(key)

  for (const [locale, dictionary] of Object.entries({ en: mod.en, zh: mod.zh })) {
    const missing = [...keys].filter((key) => typeof dictionary[key] !== 'string' || dictionary[key] === '')
    assert.deepEqual(missing, [], `${locale} cannot render these keys: ${missing.join(', ')}`)
  }
  // 两种基线是同一棵树：少一个键，切语言就会冒出键名。
  assert.deepEqual(Object.keys(mod.en).sort(), Object.keys(mod.zh).sort())
  for (const dictionary of [mod.en, mod.zh]) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `${key} must be text`)
      assert.ok(value.length > 0, `${key} is empty`)
    }
  }
  // 键名点号分段，语言包才能整棵复制；0.3 的 camelCase 平键一个都不该留下。
  for (const key of Object.keys(mod.en)) {
    if (key === 'description' || key === 'note') continue
    assert.match(key, /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/, `${key} must be a dotted key`)
  }
  assert.notEqual(mod.en.description, mod.zh.description)
  // 能力名按各自语言，后端一律产品名。
  assert.equal(mod.zh['section.files'], '文件名检索')
  assert.equal(mod.en['section.files'], 'File names')
  assert.equal(mod.zh['engine.everything'], 'Everything')
  assert.equal(mod.zh['engine.anytxt'], 'Anytxt')
})

/** `lib/locales/` 里的语言 id（文件名去扩展名）；目录不存在时为空表。 */
function localePackNames() {
  try {
    return readdirSync(new URL('../lib/locales/', import.meta.url))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
  } catch {
    return []
  }
}

/** 一段文案里的 `{name}` 占位符集合；语序不同，数量必须一致。 */
function placeholders(text) {
  return new Set(String(text).match(/\{[A-Za-z0-9_]+\}/g) ?? [])
}

test('every locale pack carries exactly the baseline keys and placeholders', (t) => {
  const { mod } = loadBundle()
  const baseline = Object.keys(mod.en).sort()
  const names = localePackNames()
  if (names.length === 0) {
    // 目录为空时跳过：没有译文可比，缺目录不是故障。
    t.skip('lib/locales/ has no packs')
    return
  }
  for (const lang of names) {
    const pack = JSON.parse(readFileSync(new URL(`../lib/locales/${lang}.json`, import.meta.url), 'utf8'))
    // 半份语言不合并：多一个或少一个键都失败，缺键就是页面上冒出键名。
    assert.deepEqual(Object.keys(pack).sort(), baseline, `${lang} must carry exactly the baseline key set`)
    for (const key of baseline) {
      assert.equal(typeof pack[key], 'string', `${lang}.${key} must be text`)
      assert.ok(pack[key].length > 0, `${lang}.${key} is empty`)
      assert.deepEqual([...placeholders(pack[key])].sort(), [...placeholders(mod.en[key])].sort(),
        `${lang}.${key} must keep the placeholders of the en baseline`)
    }
  }
})

test('every locale pack has a plugin-list entry in locale/', () => {
  const names = localePackNames()
  assert.ok(names.length > 0, 'this package ships at least one language pack')
  for (const lang of names) {
    const meta = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))
    assert.equal(typeof meta.meta?.title, 'string', `${lang} needs a plugin-list title`)
    assert.ok(meta.meta.title.length > 0, `${lang} title is empty`)
    assert.equal(typeof meta.meta?.description, 'string', `${lang} needs a plugin-list description`)
    assert.ok(meta.meta.description.length > 0, `${lang} description is empty`)
  }
})

test('a language pack is registered only for a language the shell already ships', async () => {
  const { mod } = loadBundle()
  const registered = []
  const ctx = {
    locale: {
      // 0.2.2 起壳子自带 ja / es / fr / de / ru / pt；这里只给最小的三门口径。
      getSnapshot: () => ({ locales: [{ id: 'zh' }, { id: 'en' }, { id: 'ja' }] }),
      register: (ns, lang, dictionary) => {
        registered.push({ ns, lang, dictionary })
        return () => {}
      },
    },
  }
  const asked = []
  await withFetch(async (url) => {
    asked.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ja: { 'item.label': 'x' },
        es: { 'item.label': 'y' },
        zh: { 'item.label': 'z' },
      }),
    }
  }, () => mod.internals.loadLocalePacks(ctx, [], () => false))
  assert.deepEqual(asked, ['/dsh-local-search/api/locales'])
  // 壳子没有 es：包被忽略；zh 是基线：不重复注册。没有 `addLanguage`，语言选择器不会被塞新条目。
  assert.deepEqual(registered.map((entry) => entry.lang), ['ja'])
  assert.equal(registered[0].ns, mod.NS)
  assert.deepEqual(registered[0].dictionary, { 'item.label': 'x' })

  // 壳子没有 getSnapshot 时，连请求都不发。
  let fetched = 0
  await withFetch(async () => {
    fetched += 1
    return { ok: true, status: 200, json: async () => ({}) }
  }, () => mod.internals.loadLocalePacks({ locale: {} }, [], () => false))
  assert.equal(fetched, 0)
})

test('the page asks the Host routes this package registers', () => {
  const { mod } = loadBundle()
  assert.equal(mod.STATUS_ROUTE, STATUS_ROUTE)
  assert.equal(mod.DESCRIBE_ROUTE, DESCRIBE_ROUTE)
  assert.equal(mod.DIAGNOSE_ROUTE, DIAGNOSE_ROUTE)
  assert.equal(mod.DRAFT_PARAM, DRAFT_PARAM)
})

test('the page mirrors the Host loopback hosts', () => {
  const { mod } = loadBundle()
  for (const host of mod.LOOPBACK_HOSTS) {
    // IPv6 字面量在 URL 里要带方括号，Host 比较前会剥掉。
    const authority = host === '::1' ? '[::1]' : host
    assert.equal(isLoopbackUrl(`http://${authority}:9920`), true, host)
    assert.equal(isLoopbackUrl(`https://${authority}`), true, host)
  }
  assert.equal(new Set(mod.LOOPBACK_HOSTS).size, mod.LOOPBACK_HOSTS.length)
  assert.equal(isLoopbackUrl('http://example.com:9920'), false)
})

test('a staged draft becomes one atomic operation on nested paths', () => {
  const { mod } = loadBundle()
  const { operations } = mod.internals
  const ops = operations({
    'files.everything.esPath': { op: 'set', text: 'C:/es.exe', numeric: false },
    'limits.maxResults': { op: 'set', text: '50', numeric: true },
    'content.anytxt.url': { op: 'unset', text: '' },
  })
  assert.deepEqual(ops, [
    { op: 'set', path: ['files', 'everything', 'esPath'], value: 'C:/es.exe' },
    { op: 'set', path: ['limits', 'maxResults'], value: 50 },
    { op: 'unset', path: ['content', 'anytxt', 'url'] },
  ])
})

test('the page gates counts live and leaves the address to the blur check', () => {
  const { mod } = loadBundle()
  const { invalidField } = mod.internals
  const fields = new Map([
    ['files.everything.esEncoding', { type: 'choice', choices: [{ value: 'gbk' }, { value: 'utf-8' }] }],
    ['content.anytxt.url', { type: 'text', localUrl: true }],
    ['limits.maxResults', { type: 'count', max: 100 }],
  ])
  assert.equal(invalidField({ 'files.everything.esPath': { op: 'set', text: 'C:/es.exe' } }, fields), undefined)
  assert.equal(invalidField({ 'limits.maxResults': { op: 'set', text: '101' } }, fields), 'limits.maxResults')
  assert.equal(invalidField({ 'limits.maxResults': { op: 'set', text: '0' } }, fields), 'limits.maxResults')
  assert.equal(invalidField({ 'limits.maxResults': { op: 'set', text: '2.5' } }, fields), 'limits.maxResults')
  // 地址不在打字时判：每敲一个字符都跳红字只会烦人，失焦时由 checkField 判（下面有专门的用例）。
  assert.equal(invalidField({ 'content.anytxt.url': { op: 'set', text: 'http://example.com:9920' } }, fields), undefined)
  assert.equal(invalidField({ 'content.anytxt.url': { op: 'set', text: '' } }, fields), undefined)
  assert.equal(invalidField({ 'content.anytxt.url': { op: 'unset', text: '' } }, fields), undefined)
})

test('a saved code page lands on the right segment instead of being rewritten', () => {
  const { mod } = loadBundle()
  const field = { choices: [{ value: 'gbk' }, { value: 'utf-8' }], aliases: { utf8: 'utf-8', utf: 'utf-8' } }
  assert.equal(mod.internals.choiceValue(field, 'utf-8'), 'utf-8')
  assert.equal(mod.internals.choiceValue(field, 'utf8'), 'utf-8')
  assert.equal(mod.internals.choiceValue(field, 'UTF'), 'utf-8')
  assert.equal(mod.internals.choiceValue(field, 'gb18030'), 'gbk')
  assert.equal(mod.internals.choiceValue(field, ''), 'gbk')
})

test('the engine card names each failed backend and its own fix', () => {
  const { mod } = loadBundle()
  const card = mod.EngineCard({
    t: (key) => key,
    failures: [
      { engine: 'everything', detail: 'not-installed', code: 'EVERYTHING_ES_NOT_FOUND' },
      { engine: 'anytxt', detail: 'not-running', code: 'ANYTXT_DOWN' },
    ],
    onClose: () => {},
  })
  // 自绘的右下角卡：`role="status"` 让读屏知道它出现了，但不抢焦点。
  assert.equal(card.type, 'div')
  assert.equal(card.props.role, 'status')
  const text = flatText(card)
  assert.match(text, /notice\.title/)
  // 一行一个失败后端，修法挂在同一行下面，两处都不重复引擎名。
  assert.match(text, /status\.everything\.down/)
  assert.match(text, /fix\.everything\.notInstalled/)
  assert.match(text, /status\.anytxt\.down/)
  // Anytxt 关掉 GUI 时最常见的原因就是没在运行：先让人启动，而不是先推下载页。
  assert.match(text, /fix\.anytxt\.notRunning/)
  const hrefs = collectElements(card, (node) => node.type === 'a').map((node) => node.props.href)
  assert.ok(hrefs.some((href) => href.includes('voidtools.com')), 'Everything links to its download page')
  assert.ok(!hrefs.some((href) => href.includes('anytxt.net')), 'a not-running Anytxt is not a download problem')

  // Everything 的修法按 `detail` 选：没启动只给「启动它」，没装 / 缺 es.exe 给下载页。
  const guidance = (failure) => mod.internals.cardGuidance((key) => key, failure)
  assert.deepEqual(guidance({ engine: 'everything', detail: 'not-running' }),
    { key: 'everything', text: 'fix.everything.notRunning' })
  assert.equal(guidance({ engine: 'everything', detail: 'not-installed' }).text, 'fix.everything.notInstalled')
  assert.match(guidance({ engine: 'everything', detail: 'not-installed' }).href, /voidtools\.com/)
  assert.equal(guidance({ engine: 'everything', detail: 'es-missing' }).text, 'fix.everything.esMissing')
  assert.match(guidance({ engine: 'everything', detail: 'es-missing' }).href, /voidtools\.com/)
  // 不认识的 detail 退回那句通用的下载指引，不留空行。
  assert.equal(guidance({ engine: 'everything', detail: 'unknown' }).text, 'fix.download.everything')
  assert.match(guidance({ engine: 'everything', detail: 'unknown' }).href, /voidtools\.com/)
  // Anytxt 按 `detail` 选：没在运行只给「启动它」（不推下载页），判断不了时给「确认 / 点击安装」。
  const down = guidance({ engine: 'anytxt', detail: 'not-running' })
  assert.equal(down.key, 'anytxt')
  assert.equal(down.text, 'fix.anytxt.notRunning')
  assert.equal(down.href, undefined)
  const unknown = guidance({ engine: 'anytxt', detail: 'unknown' })
  assert.equal(unknown.text, 'fix.anytxt.unknown')
  assert.equal(unknown.href, undefined)
  assert.deepEqual(unknown.link, { text: 'fix.anytxt.install', href: unknown.link.href })
  assert.match(unknown.link.href, /anytxt\.net/)

  // 只有「点击安装」那一段是链接：整句可点会把「确认是否在运行」也变成下载入口。
  const link = mod.internals.fixContent(unknown)
  assert.deepEqual(link[0], 'fix.anytxt.unknown')
  assert.equal(link[1].type, 'a')
  assert.equal(link[1].children[0], 'fix.anytxt.install')
  assert.match(link[1].props.href, /anytxt\.net/)
})

test('closing the card takes one press and removes it for this page', () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  let closed = 0
  const props = {
    t: (key) => key,
    failures: [{ engine: 'anytxt', detail: 'not-running' }],
    onClose: () => { closed += 1 },
  }
  const render = () => {
    hooks.begin()
    const tree = mod.EngineCard(props)
    hooks.end()
    return tree
  }
  const card = render()
  const button = findElement(card, (node) => node.props?.['aria-label'] === 'notice.close')
  assert.ok(button !== undefined, 'the close control needs a name for screen readers')
  // 有 primitives 就用它的 `Button`：颜色、焦点环、主题都跟壳子走。
  assert.equal(button.type, stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
  button.props.onClick()
  assert.equal(closed, 1, 'one press closes once')
  assert.equal(render(), null, 'the card is gone for this page')
})

test('without primitives the card still shows, with a native close button', () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => { warnings.push(String(message)) }
  let mod
  try {
    ({ mod } = loadBundle({ primitivesModule: false }))
  } finally {
    console.warn = originalWarn
  }
  let closed = 0
  const card = mod.EngineCard({ t: (key) => key, failures: [{ engine: 'anytxt' }], onClose: () => { closed += 1 } })
  // 这张卡本来就是「壳子缺东西」时才最需要出现：控件缺了也画得出来。
  assert.equal(card.type, 'div')
  assert.equal(card.props.role, 'status')
  assert.match(flatText(card), /status\.anytxt\.down/)
  const button = findElement(card, (node) => node.props?.['aria-label'] === 'notice.close')
  assert.equal(button.type, 'button')
  assert.equal(button.props.type, 'button')
  button.props.onClick()
  assert.equal(closed, 1)
  assert.equal(warnings.length, 1)
})

test('a failing startup check mounts the card in the shell overlay, and only the user closes it', async (t) => {
  // 启动检查的节奏（1.5s 轮询）靠假时钟推进，测试不该真的等。
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const { ctx, registered, disposeAll } = fakeContext()
  // 跨会话的「别再提醒」是配置里那个开关，不是浏览器会话存储：卡连读一次 sessionStorage 都不该读。
  let storageTouched = false
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      storageTouched = true
      throw new Error('the card must not remember anything in sessionStorage')
    },
  })
  const asked = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const target = String(url)
    asked.push(target)
    if (target.includes('/describe')) {
      return {
        ok: true,
        status: 200,
        json: async () => describeConfig({
          health: { pending: false, failures: [{ engine: 'anytxt', detail: 'not-running', code: 'ANYTXT_DOWN' }] },
        }),
      }
    }
    // 卡挂上之后不该再问这里：真问了说明又把「自动重探 / 自动撤卡」加回来了。
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  try {
    // 0.4 不再用 `Toast`：壳子里没有它，卡照样要出来（`loadBundle` 根本没提供这个 primitive）。
    assert.equal(stubs['@deepseek-ai/dsh-client-ui-primitives'].Toast, undefined)
    mod.apply(ctx)
    // 启动检查在 Host 侧异步跑：页面先等 1.5s 那一次 describe。
    t.mock.timers.tick(1500)
    await settleMicrotasks()

    const overlays = registered('shell.overlay')
    assert.equal(overlays.length, 1, 'the failed check must mount exactly one card')
    assert.equal(overlays[0].options.locale, mod.NS)
    const element = overlays[0].component()
    assert.equal(element.type, mod.EngineCard, 'the overlay holds this package\'s card, not a toast')
    const renderCard = () => {
      hooks.begin()
      const tree = element.type(element.props)
      hooks.end()
      return tree
    }
    const card = renderCard()
    assert.equal(card.props.role, 'status')
    assert.match(flatText(card), /status\.anytxt\.down/)
    assert.match(flatText(card), /fix\.anytxt\.notRunning/)

    // 不自动重探、不自动撤卡：时间过去多久都只有启动检查那一次 describe。
    t.mock.timers.tick(300000)
    await settleMicrotasks()
    assert.equal(asked.filter((target) => String(target).includes('/api/status')).length, 0,
      'the card must not re-probe the engines')
    assert.equal(overlays[0].disposed, false, 'the card stays until the user closes it')

    // 用户点关闭：卡撤掉，不写任何会话记忆。
    const closeButton = findElement(renderCard(), (node) => node.props?.['aria-label'] === 'notice.close')
    assert.ok(closeButton !== undefined, 'the card needs a way out')
    closeButton.props.onClick()
    await settleMicrotasks()
    assert.equal(overlays[0].disposed, true, 'closing the card removes it for this page')
    assert.equal(storageTouched, false, 'the card must not leak into sessionStorage')
  } finally {
    globalThis.fetch = originalFetch
    disposeAll()
    delete globalThis.sessionStorage
    t.mock.timers.reset()
  }
})

test('a clean or disabled startup check mounts no card at all', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const originalFetch = globalThis.fetch
  /** 挂一次页面，推进 1.5s，回它往 `shell.overlay` 里注册了什么。 */
  const overlaysAfter = async (health) => {
    const { mod } = loadBundle()
    const context = fakeContext()
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig({ health }) }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    mod.apply(context.ctx)
    t.mock.timers.tick(1500)
    await settleMicrotasks()
    const overlays = context.registered('shell.overlay')
    context.disposeAll()
    return overlays
  }
  try {
    // 没有失败：一句「一切正常」都不出。
    assert.deepEqual(await overlaysAfter({ pending: false, failures: [] }), [])
    // 开关关掉：Host 不探也不报，页面也不出卡。
    assert.deepEqual(await overlaysAfter({
      pending: false,
      disabled: true,
      failures: [{ engine: 'anytxt', detail: 'not-running', code: 'ANYTXT_DOWN' }],
    }), [])
  } finally {
    globalThis.fetch = originalFetch
    t.mock.timers.reset()
  }
})

test('the diagnose button fetches the Host text and opens a copy dialog', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const text = 'dsh-local-search 0.4.0\ndsh 0.2.1-rc.5\nshell=browser profile=desktop remote=no'
  const asked = []
  const written = []
  await withGlobals({
    location: { hostname: '127.0.0.1' },
    __DSH_BOOT__: { release: { version: '0.2.1-rc.5' } },
    navigator: { clipboard: { writeText: async (value) => { written.push(value) } } },
  }, () => withFetch(async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    asked.push(target)
    return { ok: true, status: 200, json: async () => ({ text }) }
  }, async () => {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => true })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    // 本机 Host：不多一句「检索的是另一台机器的盘」。
    assert.ok(!flatText(page.tree()).includes('remote.note'))

    const diagnoseButton = findElement(page.tree(), (node) => labelOf(node) === 'diagnose.copy'
      && node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
    assert.ok(diagnoseButton !== undefined, 'the page needs a copy-diagnostics button')
    assert.equal(diagnoseButton.props.variant, 'outline')
    diagnoseButton.props.onClick()
    await pump(hooks, page.render)

    assert.equal(asked.length, 1)
    // shell / remote / dsh 只有页面知道，走查询参数交给 Host 当字符串拼进文本。
    const diagnoseTarget = new URL(asked[0], 'http://localhost')
    assert.equal(diagnoseTarget.pathname, DIAGNOSE_ROUTE)
    const params = diagnoseTarget.searchParams
    assert.equal(params.get('shell'), 'browser')
    assert.equal(params.get('remote'), 'no', 'a loopback host is not another machine')
    assert.equal(params.get('dsh'), '0.2.1-rc.5')

    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'the text must open in a dialog')
    assert.equal(modal.props.title, 'diagnose.title')
    // 可全选的 textarea：只读，值是 Host 那份文本，复制按钮在弹窗页脚。
    const area = findElement(modal.props.children, (node) => node.type === 'textarea')
    assert.ok(area !== undefined, 'the dialog must show the text')
    assert.equal(area.props.readOnly, true)
    assert.equal(area.props.value, text)

    modalButton(modal, 'diagnose.copyAction').props.onClick()
    await pump(hooks, page.render)
    assert.deepEqual(written, [text], 'the copy button writes the text to the clipboard')
    const copied = openModal(page.tree(), stubs)
    assert.ok(modalButton(copied, 'diagnose.copied') !== undefined, 'the button says it was copied')
    // 文本还在，用户随时能再复制一次。
    assert.equal(findElement(copied.props.children, (node) => node.type === 'textarea').props.value, text)
  }))
})

test('a refused clipboard says so instead of failing silently, and a remote host is called out', async () => {
  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  const asked = []
  await withGlobals({
    location: { hostname: '192.168.1.20' },
    navigator: { clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } },
  }, () => withFetch(async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    asked.push(target)
    return { ok: true, status: 200, json: async () => ({ text: 'diagnostics' }) }
  }, async () => {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async () => true })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    // 页面连的是另一台机器上的 Host：不说一句，用户会以为搜的是自己这台。
    assert.match(flatText(page.tree()), /remote\.note/)

    findElement(page.tree(), (node) => labelOf(node) === 'diagnose.copy'
      && node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button).props.onClick()
    await pump(hooks, page.render)

    const params = new URL(asked[0], 'http://localhost').searchParams
    assert.equal(params.get('remote'), 'yes')
    // 没有 `window.__DSH_BOOT__` 时整段省略，不写 unknown= 占位。
    assert.equal(params.get('dsh'), null)

    const modal = openModal(page.tree(), stubs)
    modalButton(modal, 'diagnose.copyAction').props.onClick()
    await pump(hooks, page.render)

    const refused = openModal(page.tree(), stubs)
    // 被拒时不能只弹一句失败：文本还留在可选中的 textarea 里，另外说清怎么手动复制。
    assert.match(flatText(refused.props.children), /diagnose\.copyFailed/)
    assert.equal(findElement(refused.props.children, (node) => node.type === 'textarea').props.value, 'diagnostics')
    assert.ok(modalButton(refused, 'diagnose.copied') === undefined, 'a refused copy must not claim success')
  }))
})

test('the desktop shell is not a remote Host', async () => {
  // 回归：桌面壳用 `dsh-app://app` 供页面，hostname 是 `app`；当成「另一台机器」会在页面上
  // 多出一行「检索的是那台机器的盘」，诊断文本里也会写 remote=yes。
  const { mod } = loadBundle()
  await withGlobals({ location: { protocol: 'dsh-app:', hostname: 'app' }, dshDesktop: {} }, () => {
    assert.equal(mod.internals.shellName(), 'desktop-app')
    assert.equal(mod.internals.remoteOf(), 'no')
    const url = mod.internals.diagnoseUrl()
    assert.match(url, /shell=desktop-app/)
    assert.match(url, /remote=no/)
  })
  // 真的从另一台机器上的 Host 打开时才是 yes。
  await withGlobals({ location: { protocol: 'http:', hostname: '192.168.1.20' } }, () => {
    assert.equal(mod.internals.remoteOf(), 'yes')
  })
})

test('the startup check is described as a flag field and saved as a boolean', async () => {
  const startup = describeConfig().sections.find((section) => section.id === 'startup')
  assert.deepEqual(startup.fields.map((field) => [field.path.join('.'), field.type, field.labelKey]),
    [['checkEnginesOnStart', 'flag', 'field.checkEnginesOnStart.label']])

  const hooks = liveHooks()
  const { mod, stubs } = loadBundle({ hooks: hooks.react })
  let ops
  await withFetch(async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    return { ok: true, status: 200, json: async () => ({ ok: true, everything: { ok: true }, anytxt: { ok: true } }) }
  }, async () => {
    const page = mountPage(mod, hooks, {
      state: { value: { checkEnginesOnStart: true }, user: {}, writable: true },
      mutate: async (next) => { ops = next; return true },
    })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    // 桩不会展开函数组件，所以按标识找到宿主节点，再像 React 那样把它展开成 Switch。
    const host = findElement(page.tree(), (node) => node.type === mod.FlagField)
    assert.ok(host !== undefined, 'the startup section must render the flag field')
    assert.equal(host.props.value, true, 'the saved value decides the initial state')
    const expanded = mod.FlagField(host.props)
    const toggle = findElement(expanded, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Switch)
    assert.ok(toggle !== undefined, 'a deployment with Switch renders the flag with it')
    assert.equal(toggle.props.id, 'plugin-config-local-search-checkEnginesOnStart')
    assert.equal(toggle.props.label, 'field.checkEnginesOnStart.label')
    assert.equal(toggle.props.checked, true)
    assert.equal(typeof toggle.props.onChange, 'function')

    // 改它 = 一条 `set`，值是布尔——不是 "true"、也不是 1。
    toggle.props.onChange(false)
    await pump(hooks, page.render)
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.deepEqual(ops, [{ op: 'set', path: ['checkEnginesOnStart'], value: false }])

    // 反方向一样：再打开一次，落盘的仍是布尔。
    toggle.props.onChange(true)
    await pump(hooks, page.render)
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.deepEqual(ops, [{ op: 'set', path: ['checkEnginesOnStart'], value: true }])
  })
})

test('a deployment without Switch falls back to a native checkbox for the flag field', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react, omit: 'Switch' })
  let ops
  await withFetch(async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    return { ok: true, status: 200, json: async () => ({ ok: true, everything: { ok: true }, anytxt: { ok: true } }) }
  }, async () => {
    const page = mountPage(mod, hooks, { state: { value: {}, user: {}, writable: true }, mutate: async (next) => { ops = next; return true } })
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)

    const host = findElement(page.tree(), (node) => node.type === mod.FlagField)
    assert.ok(host !== undefined, 'the flag must not disappear when the switch primitive is missing')
    const expanded = mod.FlagField(host.props)
    const box = findElement(expanded, (node) => node.type === 'input' && node.props?.type === 'checkbox')
    assert.ok(box !== undefined, 'the fallback is a native checkbox, not nothing')
    assert.equal(box.props.id, 'plugin-config-local-search-checkEnginesOnStart')
    assert.equal(box.props.checked, false)
    // 没有 `<label for>` 时可访问名只能挂在 aria-label 上，否则这个开关对读屏是无名控件。
    assert.equal(box.props['aria-label'], 'field.checkEnginesOnStart.label')
    // 原生控件的事件形状：`event.target.checked`，页面据此写成布尔。
    box.props.onChange({ target: { checked: true } })
    await pump(hooks, page.render)

    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.deepEqual(ops, [{ op: 'set', path: ['checkEnginesOnStart'], value: true }])
    assert.equal(typeof ops[0].value, 'boolean')
  })
})

test('the package icon is wired through the manifest and stays multi-colour', () => {
  const icon = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
  assert.equal(manifest.icon, 'icon.svg')
  // 跟主题走的 `currentColor` 图标在插件列表里会变成一片纯色；渐变才是发布出去的样子。
  assert.match(icon, /<linearGradient/)
  assert.ok(!icon.includes('currentColor'))
})
