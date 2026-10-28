# Architecture

`@fishdivinity/dsh-local-search` is a native Cordis **Host** plugin. It registers five model-facing tools and talks to two local indexes; it does not use MCP and does not run a separate server process.

## Data flow

```
Agent
  -> local_search_files      -> files engine (Everything / es.exe)
  -> local_search_content    -> content engine (Anytxt JSON-RPC)
  -> local_search_fragments  -> content engine.fragments(ref)
  -> local_search_read       -> content engine.read(ref)
  -> local_search_status     -> engine status + configured roots
```

`lib/engines.js` is the provider registry:

- files engine: `{ name, search(args), status(args) }`
- content engine: `{ name, search(args), fragments(args), read(args), status(args) }`

`auto` selects the first registered engine. Tool names and `engine` values stay stable when a backend is added; the registry and the backend module change. Content items carry `engine` plus a self-describing `ref` (`<engine>:<id>`) so `local_search_read`/`local_search_fragments` cannot silently resolve a ref against the wrong backend.

Status is the one remaining v1-specific surface: it probes the registered engines but renders the familiar Everything/Anytxt labels. A third engine should add its display label/formatter (or a generic status array) before claiming the whole surface is registry-only.

## Boundaries

- **Read-only**: no write, delete, index-sync, OCR, export, or settings operation is registered.
- `es.exe` is spawned with a fixed argv and the model text after `--`; state-changing switches are unreachable.
- Anytxt is called only through `Search`, `GetResult`, `GetFragmentAll`, and `GetRawTextByFID`.
- Network access is limited to the configured local Anytxt endpoint.
- Results and document excerpts are capped; the plugin never auto-starts Anytxt or Everything.

## Configuration split

| File | Owner | Contains |
|---|---|---|
| `cordis.patch.yml` in this package | plugin author | The bundle patch row and `config: {}` defaults. It must ship with the package. |
| profile `cordis.patch.yml` | user/profile | Machine-specific overrides such as `esPath`, `workRoot`, `personalRoot`. Not in this repo. |
| `Config` schema in `lib/index.js` | plugin | Field names, defaults, validation. |

A user config override is a profile concern; the package patch must stay neutral so the same tarball works on every machine.

## Config page (planned)

The plugin is Host-only, so it has no configuration page yet. DSH puts plugin configuration on the **sidebar Plugins page**, not Settings' read-only "Built-in plugins" inventory. A future Client half will register `plugins.row.config` for `@fishdivinity/dsh-local-search#fishdivinity-local-search` and render the fields. A Test button needs a Host Remote/status method (the model-facing `local_search_status` is not callable from the browser); v0.2 can ship the form first and add Test once that seam exists.
