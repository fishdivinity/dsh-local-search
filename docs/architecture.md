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

- **Read-only toward the model**: no write, delete, index-sync, OCR, export, or settings tool is registered. The only writes in the package are the configuration page's own settings edits, which the Host validates and persists.
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

## Config page

The browser half (`lib/client.js`) registers **`plugins.item`** — the list the
Plugins page shows as its **Official plugins** group — and contributes one card,
exactly the way `dsh-github` contributes its GitHub card. The card shows the
one-liner (`view: 'summary'`) and opens the plugin's own page (`view: 'page'`)
with the form and its save control.

The card's `id` is not cosmetic: the page resolves the form with
`formFor(item.id)`, and that answers only for an id the Host serves as a
settings namespace — the row id this bundle's patch declares. So `id` is
`fishdivinity-local-search`; the package name would resolve no form and the page
would render its "settings namespace not served" line.

Two neighbouring slots do not fit a schema-driven form, and the page code says
so: `plugins.bundle.config` is rendered with **no form at all** (it exists for
bundles that draw and store their own settings, as `dsh-cost-meter` does), and
`plugins.row.config` can host the same form one level deeper, behind the row's
configure control. This package uses the card, because it is the surface a user
can find. Settings' "Built-in plugins" inventory is read-only and never carries
this page.

The card's artwork is the page's, not ours: `itemArtwork(id)` resolves against a
hard-coded map of the four built-in pages (`shell`, `agent-loop`, `subagent`,
`web-search`) and falls back to `PluginArtworkDefault`. No slot option and no
manifest field changes it, which is why `dsh-github` shows the same default
crystal. The package's own `icon.svg` (a multi-colour gradient, wired through
`package.json` `icon` and the `./icon` export) is what the bundle card in
Installed plugins, the npm page, and the README show. A deployment that needs its
own artwork on that card would have to contribute a sidebar panel instead.

The field grid's minimum column width is 460px, not the official pages' 220px:
this page has four path fields in one section, and 220px would seat them as four
cramped columns. Each field also sits in a plain wrapper, because the field
primitive draws its row separator with `.field + .field` — two fields that were
direct grid siblings would paint a half-width rule inside the cell.

Five constraints hold the page together:

- **Volatile fields are the seam.** Only a `.volatile()` field is served to the
  browser and writable from it. `lib/config.js` therefore returns a plain
  snapshot per tool call; no module may cache a live reference.
- **`timeoutMs` stays out.** `defineTool` fixes each deadline at registration,
  so a page edit could not take effect without reloading the row; it remains a
  profile-YAML setting.
- **`esEncoding` is a control, not a schema gate.** The page offers `gbk` /
  `utf-8`, while the schema keeps a free string: 0.1 accepted any
  `TextDecoder` label and fell back to UTF-8, so a union here would refuse to
  activate a profile that worked yesterday. The page normalizes the saved label
  so an old `utf8` lands on the right segment instead of being rewritten on save.
- **No CSS of its own.** The form is built from
  `@deepseek-ai/dsh-client-ui-primitives` (`SettingsForm`,
  `SettingsValueField`, `SegmentedControl`, `Button`, `Tag`) and theme tokens,
  and it copies the official settings pages' layout: sections with a 13px
  heading over a `repeat(auto-fit, minmax(min(220px, 100%), 1fr))` field grid,
  so a UI skin restyles it for free.
- **The Test control crosses one Host seam.** A page cannot POST to the local
  Anytxt JSON-RPC (cross-origin on both sides), so the Host registers a
  read-only `exact` route `GET /dsh-local-search/api/status` on `webServer`.
  `lib/probe.js` runs one probe for both that route and `local_search_status`,
  so the two answers cannot drift. The route sends no CORS headers, so a foreign
  page cannot read the answer; because a plain GET still costs an `es.exe` spawn,
  it also refuses requests a browser marks cross-site (`Sec-Fetch-Site`) or whose
  `Origin` is not this Host. `?anytxtUrl=` carries the address as typed, so
  testing never needs a save first, and that draft is accepted only as a loopback
  `http(s)` URL, so the route cannot be used as a request-forwarding proxy.
- **`anytxtUrl` is loopback-only, enforced where it is used.** Both indexes
  describe this machine: `es.exe` is spawned here, and every Anytxt result
  carries a path that only resolves here. A remote endpoint would answer with
  another machine's paths, so `lib/anytxt.js` refuses it with
  `ANYTXT_ENDPOINT_REMOTE` — at call time, not at activation, so a profile that
  0.1 accepted still loads and only the content search reports the mistake.
  Tunnelling a remote index in lands it on loopback anyway, which is why the
  restriction costs nothing real.

A failing probe names the official download page for the engine that is
missing. That is the whole installation story: `es.exe` and Anytxt are separate
products whose licences allow use but not redistribution, so this package never
bundles them, downloads them, or installs them on the user's behalf.
