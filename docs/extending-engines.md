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

`auto` follows the backend configured for that capability (`files.backend` /
`content.backend`), so the registry order no longer picks the default. Explicit
`engine` values resolve by name; an unknown name becomes `ENGINE_UNSUPPORTED`,
which the tool layer converts to a `HarnessError`.

## 3. Keep refs unambiguous

`local_search_content` returns `{ ref, engine, path }` where `ref` is `<engine>:<id>`. The registry wrapper adds the prefix; the backend receives the raw id. `local_search_read` and `local_search_fragments` parse the prefix, resolve the matching engine, and accept `engine` only as an assertion. Do not assume a numeric/string id is globally unique across engines.

## 4. Tests and docs

- Add a unit test with a mock transport/fixture; no DSH runtime is needed for backend modules.
- Add the engine to `engineNames()` coverage if the status surface should mention it.
- Update `README.md` / `README-zh.md` with requirements, scope semantics, and error codes.
- Add a `docs/` note for user-installed prerequisite/index behavior.

A new backend must not change the five tool names. Only `engine` values and registry entries grow.

## Configuring a new backend

The page renders what `GET /dsh-local-search/api/describe` reports, so a new backend needs no page logic — only its own rows in four places:

- `lib/engines.js`: one entry in `filesEngines` or `contentEngines`. The selector in `lib/describe.js` is built from `engineNames()`, so a registered backend appears there without further edits.
- `lib/config.js`: its paths in `PATHS` and its defaults in `DEFAULTS`; `lib/schema.js`: one `FIELDS` row per editable value.
- `lib/describe.js`: an `ENGINE_FIELDS[<capability>][<name>]` entry listing its fields — path, type, label/hint keys, `probeEndpoint: true` on the field the Test button probes, and `verifyPath: true` on a field whose value is a file path the page should confirm exists before saving — plus an `ENGINE_LABEL_KEYS` entry when the product name differs from the registry name.
- `lib/client.js`: two dictionary strings per field (zh and en), and the backend label when it has a curated name.

`test/describe.test.js` fails when a registered backend has no described field, so a registration cannot ship unconfigurable; the same suite checks that every described path resolves in a configuration snapshot.
