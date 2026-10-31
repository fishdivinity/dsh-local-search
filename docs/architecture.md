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

`auto` (or an omitted `engine`) resolves the backend configured for that capability — `files.backend` / `content.backend` — so the default is a setting rather than the registry order; an explicit value still resolves by registry name. Tool names and `engine` values stay stable when a backend is added; the registry and the backend module change. Content items carry `engine` plus a self-describing `ref` (`<engine>:<id>`) so `local_search_read`/`local_search_fragments` cannot silently resolve a ref against the wrong backend.

Status is the one remaining v1-specific surface: it probes the registered engines but renders the familiar Everything/Anytxt labels. A third engine should add its display label/formatter (or a generic status array) before claiming the whole surface is registry-only.

## Boundaries

- **Read-only toward the model**: no write, delete, index-sync, OCR, export, or settings tool is registered. The package's only writes are settings edits the Host validates and persists: the page's own saves, the 0.2 key migration, and the first-run autoconfiguration.
- `es.exe` is spawned with a fixed argv and the model text after `--`; state-changing switches are unreachable.
- Anytxt is called only through `Search`, `GetResult`, `GetFragmentAll`, and `GetRawTextByFID`.
- Network access is limited to the configured local Anytxt endpoint.
- Results and document excerpts are capped; the plugin never auto-starts Anytxt or Everything.

## Configuration split

| File | Owner | Contains |
|---|---|---|
| `cordis.patch.yml` in this package | plugin author | The bundle patch row and `config: {}` defaults. It must ship with the package. |
| profile `cordis.patch.yml` | user/profile | Machine-specific overrides such as `files.everything.esPath`, `scopes.workRoot`, `scopes.personalRoot`. Not in this repo. |
| `Config` schema in `lib/schema.js` | plugin | Field names, defaults, validation. `lib/index.js` re-exports it. |

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

The form is two capability sections followed by two plain ones. **File names** and
**File contents** each open with a backend selector and show only the selected
backend's fields; **Search scopes** and **Limits** are the same whichever backend
runs, so they close the page. The Test button sits at the foot of the grid in the
section that owns the field marked `probeEndpoint`, which keeps it beside the
address it probes instead of letting it drift down the page.

The field grid seats two columns from 656px up and one below, with the grid capped
at 1100px: two columns at full width are 2×542, the same as before, and a ~700px
container still gets two columns of ~342. The column count comes from a
`matchMedia('(min-width: 656px)')` query, not from `auto-fit`: a single minimum
column width cannot satisfy both "two columns at 700px" (needs ≤342px) and "no
third column at 1100px" (needs >366px). Each field also sits in a plain wrapper,
because the field primitive draws its row separator with `.field + .field` — two
fields that were direct grid siblings would paint a half-width rule inside the
cell — and that wrapper caps a cell at 560px, so the one-column fallback is not
stretched across the page either.

Two token names bite here. State colours live under
`--dsw-alias-state-{error,warn,success}-primary`; a name that does not exist falls
back silently to inherited text colour, which is how an alert once rendered as
ordinary body copy. The blocked-save line and the reset notices share one red,
non-bold style. Links use `--dsw-alias-link`, not `--dsw-alias-brand-primary` —
the brand token is a near-neutral, so links styled with it read as plain text.

These constraints hold the page together:

- **Volatile fields are the seam.** Only a `.volatile()` field is served to the
  browser and writable from it. The nested leaves are the volatile ones
  (`files.everything.esPath`, `content.anytxt.url`, …), and the page writes them
  back with `settings.mutate` using their nested path; `lib/config.js` therefore
  returns a plain snapshot per tool call, and no module may cache a live reference.
- **The Host owns the topology; the client owns the wording.**
  `GET /dsh-local-search/api/describe` answers with the sections, each capability's
  registered backends, every field's path, type and hard cap, and the reset recipe;
  `lib/client.js` turns the returned keys into zh/en copy and renders them. The
  topology is schema fact — `lib/schema.js` and `lib/describe.js` already know the
  path, the type and the cap — while the sentences are UI text that has to ship in
  the browser half. A backend without a `labelKey` simply renders its registry
  name, so only a product with a curated name needs one.
- **`timeoutMs` stays out.** `defineTool` fixes each deadline at registration,
  so a page edit could not take effect without reloading the row; it remains a
  profile-YAML setting.
- **`esEncoding` is a control, not a schema gate.** The page offers `gbk` /
  `utf-8`, while the schema keeps a free string: 0.1 accepted any
  `TextDecoder` label and fell back to UTF-8, so a union here would refuse to
  activate a profile that worked yesterday. The page normalizes the saved label
  through the `aliases` describe supplies, so an old `utf8` lands on the right
  segment instead of being rewritten on save.
- **No per-field badge or reset.** The page is the only surface that writes these
  values, so marking each row "set on this page" carries no information, and a
  reset button per row invites clearing one field without seeing what the others
  will fall back to. One **Reset** control runs the same pass as the first-run
  configuration: it clears the engine and limit fields, probes once, refills
  `esPath` and the Anytxt address when the probe found them (skipping a value that
  equals the default), and pins the marker. `describe.reset` carries that recipe, so
  the page does not hardcode which fields a reset touches; `scopes` is absent from
  the list because those are paths the user typed. It sits just under the
  description and asks in a dialog before writing.
- **Confirmations and results are dialogs.** Reset, a save the pre-save check
  refused, and the Test connection result all use the primitives' `Modal`: it
  portals itself to `document.body`, so the page still ships no CSS, and the
  shell's own layer supplies Escape, the Tab trap, and returning focus on close.
  `Modal` is optional the way `Toast` is — a deployment whose primitives predate it
  keeps the in-page line and the two-press Reset, because there is no stylesheet
  here to draw a substitute layer.
- **No CSS of its own.** The form is built from
  `@deepseek-ai/dsh-client-ui-primitives` (`SettingsForm`,
  `SettingsValueField`, `SegmentedControl`, `Button`) and theme tokens, so
  a UI skin restyles it for free. `Toast` and `Modal` are optional: a deployment
  whose primitives lacks them gets no engine notice and no dialog, because the
  package ships no stylesheet for a hand-rolled overlay.
- **Two read-only routes share one guard.** A page cannot POST to the local
  Anytxt JSON-RPC (cross-origin on both sides), and it cannot know which backends
  the Host registered, so the Host serves `GET /dsh-local-search/api/status` and
  `GET /dsh-local-search/api/describe` as `exact` routes on the bare `webServer`.
  Both refuse anything but `GET`/`HEAD`, and both answer a browser-marked
  cross-site request (`Sec-Fetch-Site`, or an `Origin` that is not this Host) with
  `CROSS_SITE_REFUSED`: a plain GET still spends an `es.exe` spawn on one route
  and hands out this machine's backend names on the other. Neither sends CORS
  headers, so a foreign page cannot read the answer. `lib/probe.js` runs one probe
  for the status route and `local_search_status`, so the two answers cannot
  drift. `?anytxtUrl=` carries the address as typed, so testing never needs a
  save first, and that draft is accepted only as a loopback `http(s)` URL, so the
  route cannot be used as a request-forwarding proxy. `?esPath=` answers a
  narrower question — whether that path exists — and never starts the file it
  names: a route that spawns whatever path it is handed would be an execution
  interface, not a check. `?dir=` (repeatable, one per `allRoots` entry) answers the
  same question for the four scope paths, which the schema validates only when a
  tool call uses them. A path that exists but is the wrong kind answers its own code
  (`DIR_NOT_DIRECTORY` for a file where a directory belongs, `ES_PATH_NOT_FILE` for
  the reverse), because "not found" and "wrong slot" call for different fixes.
  `?checkOnly=1` answers the draft checks alone and skips the
  probe, so a field can be checked when focus leaves it without paying for an
  `es.exe` spawn.
- **A save is verified before it lands.** The page asks the Host about the drafts
  describe marked `probeEndpoint` / `verifyPath` / `verifyDir`, and a failing answer
  holds the write and asks in a dialog, so writing a known-unreachable configuration
  takes a deliberate press. Path drafts are rewritten to one spelling first (upper-case
  drive letter, backslashes, no doubled or trailing separator; `allRoots` entry by
  entry) so the check and the write see the same string, while POSIX-style values are
  left alone for deployments that are not on Windows. The status route also answers the
  on-disk spelling of every draft it accepted, and the page writes that back, so
  `d:/alpha` lands as `D:\Alpha` rather than as a look-alike. The same checks run
  when focus leaves a path field (`?checkOnly=1`), so a wrong path is flagged under
  the input instead of waiting for the save. A hard rejection (400: no
  file, no directory, a refused address) is a wrong value rather than a transient one,
  so its dialog offers only closing. The gate is page-side because the Host's settings
  service owns the write and validates the schema, not reachability; refusing outright
  would also remove the legitimate order of saving an address and then starting the
  engine.
- **`content.anytxt.url` is loopback-only, enforced where it is used.** Both indexes
  describe this machine: `es.exe` is spawned here, and every Anytxt result
  carries a path that only resolves here. A remote endpoint would answer with
  another machine's paths, so `lib/anytxt.js` refuses it with
  `ANYTXT_ENDPOINT_REMOTE` — at call time, not at activation, so a profile that
  0.1 accepted still loads and only the content search reports the mistake.
  Tunnelling a remote index in lands it on loopback anyway, which is why the
  restriction costs nothing real.
- **First use configures what the probe found, once.** After `apply` and once the
  Loader has settled every entry (`settings.describe()` only lists active ones, so
  running earlier finds no namespace to write), `lib/bootstrap.js` moves the nine
  0.2 flat keys into the nested config and unsets them. While
  `files.everything.esPath` or `content.anytxt.url` is still unset on the user layer,
  it probes once and writes only what answered: a detected `es.exe` path, and an
  Anytxt address that differs from the default (the engine reports the port that
  answered, not the one it tried first, so a `:9921`-only install is recorded).
  The same write records `autoConfigured: true`, hidden from the page: from then on
  the pass never runs again, so a field the user cleared stays cleared instead of
  being refilled. A complete configuration skips the probe and only pins that
  marker, which is why there is no startup cost after the first run. A migration the
  settings layer refuses (a home patch overriding the profile) only logs a warning
  and leaves the flat keys in place, which `readConfig` still reads, so the plugin
  keeps working. Every shape change is one row in `RETIRED_PATHS`, and all three
  consumers (read fallback, the hidden schema keys, the startup migration) share that
  list, so a profile may skip any number of versions: see `docs/config-migration.md`.
  A probe that finds an engine down reports it in the payload's
  `autoconfig` block, and the page shows one `Toast` per browser session.

A failing probe names the official download page for the engine that is
missing. That is the whole installation story: `es.exe` and Anytxt are separate
products whose licences allow use but not redistribution, so this package never
bundles them, downloads them, or installs them on the user's behalf.
