# Extending engines

The tool surface is intentionally capability-based (`local_search_files` / `local_search_content` / `local_search_fragments` / `local_search_read` / `local_search_status`). New backends are added behind the same tools.

## 1. Implement a provider

Put the backend in `lib/` (for example `lib/other-files.js` or `lib/other-content.js`) and export plain functions without importing DSH runtime packages, so it stays unit-testable under Node:

```js
// files engine
export async function searchFiles(args) { /* -> { items, truncated } */ }
export async function getVersion(args) { /* -> string */ }

// content engine
export async function searchContent(args) { /* -> { items, total, truncated } */ }
export async function getFragments(args) { /* -> string[] */ }
export async function getRawText(args) { /* -> string */ }
```

`items` for content already carry `ref`; the registry wrapper should add `engine: name` (the tools add it for the registered engine today).

## 2. Register it

In `lib/engines.js`, add one entry to `filesEngines` or `contentEngines`:

```js
const contentEngines = new Map([
  ['anytxt', { name: 'anytxt', search, fragments, read, status }],
  ['other', { name: 'other', search: otherSearch, fragments: otherFragments, read: otherRead, status: otherStatus }],
])
```

`auto` resolves the first entry. Explicit `engine` values resolve by name; an unknown name becomes `ENGINE_UNSUPPORTED`, which the tool layer converts to a `HarnessError`.

## 3. Keep refs unambiguous

`local_search_content` returns `{ ref, engine, path }` where `ref` is `<engine>:<id>`. The registry wrapper adds the prefix; the backend receives the raw id. `local_search_read` and `local_search_fragments` parse the prefix, resolve the matching engine, and accept `engine` only as an assertion. Do not assume a numeric/string id is globally unique across engines.

## 4. Tests and docs

- Add a unit test with a mock transport/fixture; no DSH runtime is needed for backend modules.
- Add the engine to `engineNames()` coverage if the status surface should mention it.
- Update `README.md` / `README-zh.md` with requirements, scope semantics, and error codes.
- Add a `docs/` note for user-installed prerequisite/index behavior.

A new backend must not change the five tool names. Only `engine` values and registry entries grow.

## Config page debt

The registry is engine-agnostic; the configuration page is not. `lib/client.js`
lays out sections named after the two engines (`esPath` / `esEncoding` under
Everything, `anytxtUrl` under Anytxt) and the schema's own fields are named
after them too (`esPath`, `anytxtUrl`, `esEncoding`).

A second backend therefore needs, before it can be configured rather than
hard-coded:

- a schema that keeps each engine's settings in a nested object the page can
  render one section per engine, instead of one flat set of engine-named keys;
- a page that iterates the registry and renders a section per engine, with the
  Test control probing that engine's own endpoint;
- a probe route per engine rather than the current single both-engines probe.

Until then a new engine is configurable only through the profile YAML, exactly
as the current fields are.
