import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeConfig } from '../lib/describe.js'
import { DESCRIBE_ROUTE, DRAFT_PARAM, STATUS_ROUTE } from '../lib/route.js'
import { isLoopbackUrl } from '../lib/config.js'

const clientUrl = new URL('../lib/client.js', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)
const patchUrl = new URL('../cordis.patch.yml', import.meta.url)
const source = readFileSync(clientUrl, 'utf8')
const manifest = JSON.parse(readFileSync(packageUrl, 'utf8'))
const patch = readFileSync(patchUrl, 'utf8')

/**
 * 像客户端模块系统那样加载发布出去的 bundle：普通脚本 + 打桩的 `require`。
 * @param options - `buttonAsForwardRef` 复刻真实 primitives（`Button` 是 `forwardRef(...)`，
 * 因此是对象而不是函数）；`omit` 去掉一个 primitive，模拟更旧的部署；`toast` 加上 `Toast`；
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
    Tag: primitive(),
  }
  if (options.omit !== undefined) delete primitives[options.omit]
  if (options.toast === true) primitives.Toast = primitive()
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

/** 在渲染树里找第一个满足条件的元素（`children` 与 `props.children` 都走）。 */
function findElement(tree, predicate) {
  if (tree === null || tree === undefined) return undefined
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const hit = findElement(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (typeof tree !== 'object') return undefined
  if (predicate(tree)) return tree
  return findElement(tree.children, predicate) ?? findElement(tree.props?.children, predicate)
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

/** 一个记录浏览器半边注册了什么、并收集清理函数的插件上下文。 */
function fakeContext() {
  const registrations = []
  const disposers = []
  return {
    registrations,
    disposeAll() {
      while (disposers.length > 0) disposers.pop()()
    },
    ctx: {
      effect: (fn) => {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      slots: {
        inject: (name, register) => {
          if (name === 'shell.overlay') throw new Error('this deployment has no overlay slot')
          return register()
        },
        register: (options, component) => {
          registrations.push({ kind: 'slot', name: options.name, options, component })
          return () => {}
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
  assert.equal(flatText(tree), 'primitivesMissing')
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
    assert.match(flatText(page.tree()), /describeLoading/, 'the first frame asks the reader to wait')
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    assert.deepEqual(sectionTitles(page.tree()), ['sectionFiles', 'sectionContent', 'sectionScopes', 'sectionLimits'])
    assert.ok(!flatText(page.tree()).includes('describeLoading'))
  } finally {
    globalThis.fetch = original
  }
})

test('a failed description fetch leaves a retry instead of the loading line', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => flatText(page.tree()).includes('describeFailed'))
    const text = flatText(page.tree())
    assert.ok(text.includes('describeFailed'), `expected the failure line, got: ${text.slice(0, 160)}`)
    assert.ok(text.includes('HTTP 503'))
    assert.ok(text.includes('retry'))
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
    assert.equal(modal.props.title, 'saveAnywayTitle')
    assert.match(modal.props.description, /saveEngineDown/)
    // 保存按钮不改字：弹窗里的「仍然保存」才是那个第二下。
    assert.equal(page.tree().props.labels.save, 'save')

    // 弹窗里选「仍然保存」：用户已经知道引擎不可用，按他说的写。
    modalButton(modal, 'saveAnyway').props.onClick()
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
    assert.equal(modal.props.title, 'saveBlockedTitle')
    // 句号来自字典（英文是 "."），不写死在模板里。
    assert.equal(modal.props.description, 'savePathMissingfullStop')
    assert.equal(modalButton(modal, 'saveAnyway'), undefined, 'a hard error must not offer a force save')
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
    assert.match(flatText(page.tree()), /saveEngineDown/)
    assert.equal(page.tree().props.labels.save, 'saveAnyway')
    page.tree().props.onSave()
    await pump(hooks, page.render)
    assert.equal(mutations, 1)

    // 重置也还是「点两下」：第一下换成确认按钮，第二下才写。
    const resetEntry = () => findElement(page.tree(), (node) => node.type !== undefined
      && Array.isArray(node.children) && node.children.join('') === 'reset')
    resetEntry().props.onClick()
    await pump(hooks, page.render)
    assert.equal(mutations, 1, 'the first press only asks')
    const confirm = () => findElement(page.tree(), (node) => Array.isArray(node.children) && node.children.join('') === 'resetConfirm')
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
  assert.equal(flatText(tree), 'primitivesMissing')
})

test('fields carry no badge or per-field reset; three candidate reset rows share one handler', async () => {
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
    const labels = buttons.map((button) => (Array.isArray(button.children) ? button.children.join('') : String(button.children)))
    // 只剩一个入口：描述正下方那个实心按钮。
    assert.deepEqual(labels.filter((label) => label.startsWith('reset')), ['reset'])
    const resetButtons = buttons.filter((button) => String(button.children) === 'reset')
    assert.deepEqual(resetButtons.map((button) => button.props.variant), ['primary'])
    const topLevel = page.tree().props.children
    assert.equal(topLevel[0].props.key, 'reset-1')
    assert.deepEqual(topLevel.map((child) => child.props?.key ?? '').filter((key) => key.startsWith('reset-')), ['reset-1'])
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
      && Array.isArray(node.children) && node.children.join('') === 'reset')

    assert.ok(resetButton() !== undefined, 'the reset entry must be on the page')
    resetButton().props.onClick()
    await pump(hooks, page.render)
    // 先问一次：没写，弹窗里说清会清什么。
    assert.equal(writes.length, 0)
    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'the reset must confirm in a dialog')
    assert.equal(modal.props.title, 'resetTitle')
    assert.equal(modal.props.description, 'resetHint')
    // 标题与确认按钮都是「重置」：弹窗里没有第二遍「确认重置」这种重复。
    assert.ok(modalButton(modal, 'cancel') !== undefined, 'the dialog can be cancelled')
    modalButton(modal, 'reset').props.onClick()
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
    assert.match(flatText(page.tree()), /resetDone/)
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
    const content = findElement(page.tree(), (node) => node.props?.title === 'sectionContent')
    const testButton = findElement(content.props.footer, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
    assert.ok(testButton !== undefined, 'the test control must be on the page')
    testButton.props.onClick()
    await pump(hooks, page.render)

    assert.equal(probes, 1)
    const modal = openModal(page.tree(), stubs)
    assert.ok(modal !== undefined, 'the result must open in a dialog')
    assert.equal(modal.props.title, 'test')
    // 正文就是一个两行的无序列表：一行一个引擎，没有地址行、没有说明段。
    assert.equal(modal.props.description, undefined)
    const list = findElement(modal.props.children, (node) => node.type === 'ul')
    assert.ok(list !== undefined, 'the result must be a list')
    // 壳子给 `.body` 固定加 20px 上边距；没有 description 时用负边距拉回去，标题下不留空档。
    assert.equal(modal.props.children.props.style.marginTop, '-20px')
    assert.match(flatText(list), /everythingOk · 1\.5\.0/)
    assert.match(flatText(list), /anytxtOk/)
    // 结论只出现一次：弹窗之外不再留一份页内结果。
    assert.equal((flatText(page.tree()).match(/everythingOk/g) ?? []).length, 1)

    modalButton(modal, 'testAgain').props.onClick()
    await pump(hooks, page.render)
    assert.equal(probes, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('windows path drafts are rewritten to one standard spelling before the write', async () => {
  const { mod } = loadBundle()
  const { normalizeWinPath, normalizeWinPaths, normalizeStaged } = mod.internals
  // 盘符大写、只用反斜杠、去掉多余与末尾的分隔符。
  assert.equal(normalizeWinPath('d:/alpha'), 'D:\\alpha')
  assert.equal(normalizeWinPath('d:\\alpha\\'), 'D:\\alpha')
  assert.equal(normalizeWinPath('  C:\\\\Tools\\\\es.exe  '), 'C:\\Tools\\es.exe')
  // 盘符根只留一个反斜杠：`D:\` 不能变成 `D:`。
  assert.equal(normalizeWinPath('d:/'), 'D:\\')
  assert.equal(normalizeWinPath('\\\\server\\share\\'), '\\\\server\\share')
  assert.equal(normalizeWinPath('//server/share'), '\\\\server\\share')
  // 名字里的空格、中文、带空格的目录名都不动；POSIX 写法也不动。
  assert.equal(normalizeWinPath('D:\\Alpha\\我的项目\\drawio a'), 'D:\\Alpha\\我的项目\\drawio a')
  assert.equal(normalizeWinPath('/home/me'), '/home/me')
  assert.equal(normalizeWinPath(''), '')
  // 分号列表逐个改写，空项丢掉。
  assert.equal(normalizeWinPaths('d:/a/; e:\\b ;'), 'D:\\a;E:\\b')

  // 只改带路径语义的字段；地址不是路径，一个字符都不动。
  const fields = new Map([
    ['files.everything.esPath', { verifyPath: true }],
    ['scopes.workspaceRoot', { verifyDir: true }],
    ['content.anytxt.url', { probeEndpoint: true }],
  ])
  const { next, changed } = normalizeStaged({
    'files.everything.esPath': { op: 'set', text: 'c:/tools/es.exe' },
    'scopes.workspaceRoot': { op: 'set', text: 'd:/alpha/' },
    'content.anytxt.url': { op: 'set', text: 'HTTP://127.0.0.1:9920' },
  }, fields)
  assert.equal(changed, true)
  assert.equal(next['files.everything.esPath'].text, 'C:\\tools\\es.exe')
  assert.equal(next['scopes.workspaceRoot'].text, 'D:\\alpha')
  assert.equal(next['content.anytxt.url'].text, 'HTTP://127.0.0.1:9920')
})

test('the Host answer is refilled into the draft before it is written', async () => {
  const hooks = liveHooks()
  const { mod } = loadBundle({ hooks: hooks.react })
  const originalFetch = globalThis.fetch
  let ops
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
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
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
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
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
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

    const content = findElement(page.tree(), (node) => node.props?.title === 'sectionContent')
    const button = findElement(content.props.footer, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
    button.props.onClick()
    await pump(hooks, page.render)

    const params = new URL(asked, 'http://localhost').searchParams
    assert.equal(params.get(mod.DRAFT_PATH_PARAM), 'C:\\nope\\es.exe1')
    // 单行结论走 description，和别的弹窗正文同一个位置、同一个字号。
    const modal = openModal(page.tree(), stubs)
    assert.equal(modal.props.description, 'savePathMissingfullStop')
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
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
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
    assert.equal(field().props.invalid, true)
    assert.equal(field().props.invalidLabel, 'invalidDir')

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
    assert.equal(field().props.invalidLabel, 'invalidLocal')
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
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
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
    assert.equal(field().props.invalidLabel, 'invalidNotDir')
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
    if (target.includes('/describe')) return { ok: true, status: 200, json: async () => describeConfig() }
    return { ok: false, status: 400, json: async () => ({ ok: false, code: 'ES_PATH_NOT_FILE' }) }
  }
  try {
    const page = mountPage(mod, hooks)
    page.render()
    await page.settle(() => sectionTitles(page.tree()).length > 0)
    fieldNode(page.tree(), 'files.everything.esPath').props.onEdit('C:/Tools')
    await pump(hooks, page.render)

    const content = findElement(page.tree(), (node) => node.props?.title === 'sectionContent')
    findElement(content.props.footer, (node) => node.type === stubs['@deepseek-ai/dsh-client-ui-primitives'].Button)
      .props.onClick()
    await pump(hooks, page.render)

    // 「是个目录」和「不存在」是两种改法，弹窗不能都说「找不到文件」。
    const modal = openModal(page.tree(), stubs)
    assert.equal(modal.props.description, 'savePathNotFilefullStop')
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
    for (const backend of section.backends ?? []) if (backend.labelKey !== undefined) keys.add(backend.labelKey)
    for (const field of section.fields) {
      keys.add(field.labelKey)
      keys.add(field.hintKey)
      for (const choice of field.choices ?? []) keys.add(choice.labelKey)
    }
  }
  // 表单外壳与测试控件用到的键。
  for (const key of [
    'unavailable', 'primitivesMissing', 'autoconfigFailed', 'readOnly', 'saveFailed', 'save', 'saving', 'invalidValue', 'invalidNumber',
    'invalidFile', 'invalidDir', 'invalidLocal',
    'description', 'note', 'itemLabel', 'describeLoading', 'describeFailed', 'retry',
    'saveAnyway', 'saveAnywayTitle', 'saveBlockedTitle', 'saveEngineDown', 'saveNoWrite',
    'listSeparator', 'colon', 'fullStop',
    'savePathMissing', 'saveEndpointInvalid',
    'close', 'cancel', 'reset', 'resetTitle', 'resetConfirm', 'resetHint', 'resetting', 'resetDone', 'resetFailed',
    'saveDirMissing',
    'test', 'testing', 'testAgain', 'testHint', 'testLocalOnly', 'testFailed',
    'everythingOk', 'everythingDown', 'anytxtOk', 'anytxtDown', 'downloadEverything', 'downloadAnytxt',
    'fixEverythingNotRunning', 'fixEverythingNotInstalled', 'fixEverythingEsMissing', 'noticeEnginesDown',
  ]) keys.add(key)

  for (const [locale, dictionary] of Object.entries({ en: mod.en, zh: mod.zh })) {
    for (const key of keys) {
      assert.equal(typeof dictionary[key], 'string', `${locale} is missing ${key}`)
      assert.ok(dictionary[key].length > 0, `${locale}.${key} is empty`)
    }
  }
  assert.notEqual(mod.en.description, mod.zh.description)
  // 能力名按各自语言，后端一律产品名。
  assert.equal(mod.zh.sectionFiles, '文件名检索')
  assert.equal(mod.en.sectionFiles, 'File names')
  assert.equal(mod.zh.engineEverything, 'Everything')
  assert.equal(mod.zh.engineAnytxt, 'Anytxt')
})

test('the page asks the Host routes this package registers', () => {
  const { mod } = loadBundle()
  assert.equal(mod.STATUS_ROUTE, STATUS_ROUTE)
  assert.equal(mod.DESCRIBE_ROUTE, DESCRIBE_ROUTE)
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

test('the engine notice renders only where primitives provide Toast', () => {
  const withToast = loadBundle({ toast: true })
  const withoutToast = loadBundle()
  const engines = ['anytxt']
  const rendered = withToast.mod.internals.EngineNotice({ t: (key) => key, engines, onDone: () => {} })
  assert.equal(rendered.type, withToast.stubs['@deepseek-ai/dsh-client-ui-primitives'].Toast)
  // 本包不发布 CSS：没有 Toast 的部署宁可不提示，也不自己画一个内联样式的浮层。
  assert.equal(withoutToast.mod.internals.EngineNotice({ t: (key) => key, engines, onDone: () => {} }), null)
})

test('the package icon is wired through the manifest and stays multi-colour', () => {
  const icon = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
  assert.equal(manifest.icon, 'icon.svg')
  // 跟主题走的 `currentColor` 图标在插件列表里会变成一片纯色；渐变才是发布出去的样子。
  assert.match(icon, /<linearGradient/)
  assert.ok(!icon.includes('currentColor'))
})
