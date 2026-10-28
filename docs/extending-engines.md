# Extending engines

The tool surface is intentionally capability-based (`local_search_files` / `local_search_content` / `local_search_fragments` / `local_search_read` / `local_search_status`). New backends are added behind the same tools.

## 1. Implement a provider

Put the backend in `lib/` (for example `lib/windows-search.js` or `lib/recoll.js`) and export plain functions without importing DSH runtime packages, so it stays unit-testable under Node:

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
  ['recoll', { name: 'recoll', search: recollSearch, fragments: recollFragments, read: recollRead, status: recollStatus }],
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

## Known future candidates

- **Windows Search** (`SystemIndex`): built-in, no extra install, but Node needs COM/OLE DB or a PowerShell bridge; indexing scope is often reduced.
- **Recoll**: open source, CLI (`recollq` / `recoll -t`), user must install and index.
- **Everything 1.5 content**: same Everything backend, not a separate engine; only 1.5 alpha has content indexing.
- **TextSeek / DocFetcher / ultrasearch**: no stable public API or too early; not planned.

Adding these must not change the five tool names. Only `engine` values and registry entries grow.
