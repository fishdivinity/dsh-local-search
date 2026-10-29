import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STATUS_ROUTE } from '../lib/route.js'

const clientUrl = new URL('../lib/client.js', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)
const patchUrl = new URL('../cordis.patch.yml', import.meta.url)
const source = readFileSync(clientUrl, 'utf8')
const manifest = JSON.parse(readFileSync(packageUrl, 'utf8'))
const patch = readFileSync(patchUrl, 'utf8')

/**
 * Load the shipped bundle the way the client module system does: as a classic
 * script with a stubbed `require`.
 * @param options - `buttonAsForwardRef` mirrors the real primitives, where
 * `Button` is `forwardRef(...)` and therefore an object rather than a function;
 * `omit` drops one exported primitive, as an older deployment would be missing it.
 */
function loadBundle(options = {}) {
  let definition
  const window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  new Function('window', source)(window)
  const component = () => null
  const calls = []
  const primitives = {
    // The real Button is a forwardRef result: an object, not a function.
    Button: options.buttonAsForwardRef === true
      ? { $$typeof: Symbol.for('react.forward_ref'), render: component }
      : component,
    SegmentedControl: component,
    SettingsForm: component,
    SettingsValueField: component,
    Tag: component,
  }
  if (options.omit !== undefined) delete primitives[options.omit]
  const stubs = {
    react: {
      createElement: (type, props, ...children) => {
        calls.push({ type, props, children })
        return { type, props, children }
      },
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    },
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  const mod = definition.factory((spec) => {
    if (!(spec in stubs)) throw new Error(`unexpected require: ${spec}`)
    return stubs[spec]
  })
  return { definition, mod, stubs, calls }
}

/** A plugin context that records what the browser half registers. */
function fakeContext() {
  const registrations = []
  return {
    registrations,
    ctx: {
      effect: (fn) => fn(),
      locale: {
        bind: () => (key) => key,
        register: (namespace, dictionary) => {
          registrations.push({ kind: 'locale', namespace, dictionary })
          return () => {}
        },
      },
      slots: {
        inject: (name, register) => register(),
        register: (options, component) => {
          registrations.push({ kind: 'slot', name: options.name, options, component })
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
  const { ctx, registrations } = fakeContext()
  mod.apply(ctx)

  const slots = registrations.filter((entry) => entry.kind === 'slot')
  assert.equal(slots.length, 1, 'one configuration surface, no duplicate page')
  const slot = slots[0]
  // dsh-github contributes its GitHub card the same way.
  assert.equal(slot.name, 'plugins.item')
  // The page resolves the form by this id, and only a settings namespace answers,
  // so the id must be the row id the bundle patch declares — not the package name.
  assert.equal(slot.options.id, mod.ITEM_ID)
  assert.equal(slot.options.id, 'fishdivinity-local-search')
  assert.notEqual(slot.options.id, manifest.name)
  assert.match(patch, /id: fishdivinity-local-search/)
  assert.equal(typeof slot.options.label, 'function')
  assert.equal(slot.options.locale, mod.NS)
  assert.equal(typeof slot.component, 'function')
})

test('the page renders the form even though Button is a forwardRef object', () => {
  // Regression: a `typeof primitive === 'function'` readiness check failed on
  // every deployment, because the shipped `Button` is a forwardRef object, and
  // the page fell back to its "settings namespace not served" line.
  const { mod, stubs } = loadBundle({ buttonAsForwardRef: true })
  const form = { state: { value: {}, user: {}, writable: true }, mutate: async () => true }
  const tree = mod.ConfigPage({ t: (key) => key, form, view: 'page' })
  assert.equal(tree.type, stubs['@deepseek-ai/dsh-client-ui-primitives'].SettingsForm)
})

test('a primitive missing from an older deployment falls back instead of throwing', () => {
  const { mod } = loadBundle({ omit: 'Tag' })
  const tree = mod.ConfigPage({ t: (key) => key, form: { state: { value: {}, user: {} } }, view: 'page' })
  assert.equal(tree.type, 'p')
})

test('the Test control asks the Host route this package registers', () => {
  const { mod } = loadBundle()
  assert.equal(mod.STATUS_ROUTE, STATUS_ROUTE)
})

test('the package icon is wired through the manifest and stays multi-colour', () => {
  const icon = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
  assert.equal(manifest.icon, 'icon.svg')
  // A themed `currentColor` icon would render flat in the plugin list; the
  // gradients are what make it read like the shipped artwork.
  assert.match(icon, /<linearGradient/)
  assert.ok(!icon.includes('currentColor'))
})

test('both dictionaries carry the form chrome, sections, and every field label and hint', () => {
  const { mod } = loadBundle()
  const fields = [
    'esPath',
    'esEncoding',
    'anytxtUrl',
    'workspaceRoot',
    'workRoot',
    'personalRoot',
    'allRoots',
    'maxResults',
    'readMaxChars',
  ]
  const required = [
    'unavailable', 'readOnly', 'saveFailed', 'save', 'saving', 'overridden', 'reset', 'invalidValue', 'invalidNumber',
    'description', 'note', 'itemLabel', 'sectionEverything', 'sectionAnytxt', 'sectionScopes', 'sectionLimits',
    'encodingGbk', 'encodingUtf8', 'test', 'testing', 'testHint', 'testLocalOnly', 'testFailed', 'testWhere',
    'everythingOk', 'everythingDown', 'anytxtOk', 'anytxtDown', 'downloadEverything', 'downloadAnytxt',
  ]

  for (const [locale, dictionary] of Object.entries({ en: mod.en, zh: mod.zh })) {
    for (const key of required) {
      assert.equal(typeof dictionary[key], 'string', `${locale} is missing ${key}`)
      assert.ok(dictionary[key].length > 0, `${locale}.${key} is empty`)
    }
    for (const field of fields) {
      assert.ok(dictionary[`${field}Label`], `${locale} is missing ${field}Label`)
      assert.ok(dictionary[`${field}Hint`], `${locale} is missing ${field}Hint`)
    }
  }
  assert.notEqual(mod.en.description, mod.zh.description)
})
