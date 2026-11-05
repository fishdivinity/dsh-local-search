# Changelog

Chinese entries live in [CHANGELOG.md](CHANGELOG.md). Entries up to 0.2.1 keep the English they shipped with; 0.3.0 onward is written in both files.

## 0.4.2 — 2026-11-05

**Long labels stay in their own space**: the four search-scope options no longer paint over each other and share one line whenever the window allows. **Diagnostics ask the assistant first**: the dialog now hands the text to the AI and opens an issue only when that fails.

- `page`: option fields (default scope, `es.exe` encoding) are a hand-drawn `radiogroup` — each segment takes its content width and wraps only when it must. The host `SegmentedControl` divides its width evenly and keeps labels on one line, so Russian's `Текущее рабочее пространство` (28 characters, about 240px) painted over its neighbour and the selected highlight inside a ~200px segment, and the control itself spilled out of its field cell.
- `page`: a field that spans the row (the default scope) no longer inherits the 560px cell; at ordinary window sizes the four choices fit on one line instead of a full-width band with a lone option on the second row.
- `page`: the selected state follows each option's own width rather than an equally divided sliding indicator, so uneven tracks cannot point at the wrong segment; arrow keys, Home and End skip disabled options.
- `page`: the diagnostics hint now says to copy the text and ask the AI first, opening an issue only when that fails; `issue` links the tracker, and the "home directory is already ~" clause is gone (the redaction itself is unchanged).
- `i18n`: the six language packs gain `diagnose.issue` and a retranslated `diagnose.hint`; the `{issue}` placeholder lets each language place the link.
- `docs`: `docs/architecture.md` records why this control is hand-drawn; `docs/troubleshooting.md` and both READMEs now say to ask the assistant first and open an issue only if that fails.
- `test`: pins the full-width cell, the radiogroup's wrapping and arrow keys, and the diagnostics link target.
- `package`: version raised to 0.4.2 (patch: user-visible fixes only, no new capability).

## 0.4.1 — 2026-11-04

**Findable in the plugin market**: the catalog one-liner now says local file search and document full-text search. The market matches literally, and the old wording only said 检索, so searching for 搜索, 文件搜索 or docx never surfaced this plugin.

- `docs`: the catalog entry (that YAML in `awesome-dsh-plugin`) now names file search, full-text search and the extensions — the market search is literal substring matching, and the old Chinese sentence only said 检索, so `搜索` / `文件搜索` / `本地搜索` / `全文检索` / `docx` all returned zero hits.
- `package`: `description` is now two plain sentences (npm page and third-party crawlers) that lead with "local file search and document full-text search".
- `page`: the plugin-list title and one-liner (`locale/zh.json` / `locale/en.json`) and the card description follow the same wording; the six language packs keep their existing page copy.
- `docs`: `llms.txt` says "本机文件搜索与文档全文检索" and names the extensions as `PDF / DOCX / XLSX / PPTX / EPUB`.
- `docs`: README "Related plugins" became "How this compares" — a three-row table linking each project's GitHub repository instead of a competitor's catalog install page.
- `icon`: a new mark — paper with a magnifier cut out of it: the document is the subject, the magnifier is a hole in the page, three lines sit on the paper; `icon.png` is exported for the catalog.
- `package`: version raised to 0.4.1 (patch: no externally visible behaviour changes).

## 0.4.0 — 2026-11-03

**Knowing the machine**: platform detection, four-state probes, path semantics. **Diagnosing it**: a copyable report and one error-code document. **Fewer interruptions**: a startup check and a corner card. **More languages**: one file per language.

- `platform`: new `lib/platform.js` — `detect()` returning `os` / `pathStyle` / `caseInsensitive` / `home` / the default roots (on Windows it scans A:–Z: for existing drive roots), unit-tested for all three platforms. Platform defaults come only from there; no other module reads `process.platform` or `process.env.SystemDrive` any more.
- `search`: `~/x` expands against the home directory where it is used (a save writes back the resolved absolute path; a hand-written `~/x` in the profile still works); absolute paths are judged by the target platform's rules, and Windows also accepts `/Users/x`; `allRoots` stays semicolon-separated.
- `page`: path rewriting follows the `platform` describe reports — on Windows `D:/alpha` is stored as `D:\alpha`, POSIX spellings are left alone; save, blur checks and Test connection share one implementation, compared case by case with the Host's.
- `engines`: probing moved into each backend (`probe()` → `ready` / `missing-tool` / `missing-index` / `down`); `lib/probe.js` only aggregates, and the `sc.exe` installation check stays in `everything.js`.
- `search`: both output surfaces gained a filter — `formatStatus` emits only `ok` / `code` / `message` (plus which backend and roots are in use), so the model never sees the four states, a fix or a plugin version; the system prompt adds "do not install, start or reconfigure these engines; name the backend that is down and point the user at the plugin card"; `test/format.test.js` pins that `state` / `detail` / `hint` never reach the output.
- `config`: new `checkEnginesOnStart` key (on by default, rendered as a switch); when on, both backends are probed once per start and the result only feeds `describe.health` (`pending` / `failures` / `checkedAt` / `disabled`), never the configuration; `autoconfig.failures` is gone and the first-run pass only writes values, unaffected by the switch.
- `page`: the engine notice is a hand-drawn card in `shell.overlay` — only when something failed, colours only from `--dsw-*` tokens, one line per backend with its own fix. The card neither polls nor removes itself; the user closes it, and closing lives in component state only: no `sessionStorage`, and the cross-session "stop telling me" is `checkEnginesOnStart`. Without primitives the close button falls back to a native `button`.
- `route`: new read-only `GET /dsh-local-search/api/diagnose` returning `{ text }` — plugin and DSH versions, `profile` / `shell` / `remote`, platform and node, each backend's state and code, the four scopes, and when the probe ran; `os.homedir()` and `DSH_HOME` are reduced to `~` on the Host. Computed per request, `no-store`, behind the same cross-site gate as the other routes.
- `page`: **Copy diagnostics** under the description opens a dialog with a selectable `<textarea>` and a copy control; a refused clipboard falls back to manual selection instead of one failure line, and a deployment without `Modal` does not show the button at all. When the page talks to a Host on another machine (not loopback) it adds one line saying searches use that machine's drives.
- `docs`: new `docs/troubleshooting.md` (code → who raises it → what you see → fix, 32 codes); the README error table is replaced by one fallback sentence and a link to it.
- `i18n`: dictionary keys are dotted now (`field.esPath.label`, `section.files`, `dialog.reset.title`) and `FIELD_COPY` lives in the same baseline tree; new `GET /dsh-local-search/api/locales` (all packs at once, content-hashed ETag / 304) and `lib/locale-packs.js`; the page registers a pack only for a language the shell already knows (`getSnapshot().locales`) and never calls `addLanguage`; zh / en stay in the bundle as the synchronous baseline. The README documents the two steps of adding a language.
- `i18n`: ships initial `de` / `es` / `fr` / `ja` / `pt` (Brazilian Portuguese) / `ru` packs matching the ids DSH 0.2.2 adds. They were proofread against the English baseline and a native review is still welcome (replace a whole file); a missing pack or an id mismatch falls back to English without affecting the page.
- `test`: new `test/platform.test.js`, `test/diagnose.test.js`, `test/locale-packs.test.js`; `test/everything.test.js` / `test/anytxt.test.js` / `test/probe.test.js` / `test/engines.test.js` moved to the four states and `probe`; `test/describe.test.js`, `test/route.test.js`, `test/bootstrap.test.js`, `test/format.test.js` and `test/client.test.js` follow the new contracts.
- `search`: `scope=all` no longer hard-codes `C:\` + `D:\`; on Windows the default is every existing drive, so a newly mounted drive is picked up on the next call. A configured `scopes.allRoots` still wins.
- `search`: Anytxt multi-root results are merged by per-root rank instead of root order, so a small `limit` cannot starve later roots; an exact file-name match is promoted to the top.
- `search`: an empty result no longer calls the hit count an "indexed total"; the `query` description now says `OR`/`AND` are literal text and `|`/`&` are the operators.
- `search`: below the 100-item cap the content result keeps only the `N of M` header; `max 100` appears only once 100 are shown.
- `search`: the default scope is now `all` (whole computer); new `scopes.defaultScope` (`all` / `workspace` / `work` / `personal`), and `scope` is only a narrowing.
- `search`: when every configured `allRoots` directory is gone, the default `all` falls back to the workspace and the result says so; an empty configuration still uses the platform default roots.
- `probe`: the two backends probe in parallel, worst case about 5 seconds (they used to run serially with one 5-second budget each); the status tool and copied diagnostics no longer wait for two timeouts.
- `status`: `local_search_status` lists the roots that actually exist and adds `allFallback=workspace` when `scope=all` fell back (or `allMissing=…` for a partially missing root); content results say the same.
- `status`: the "skipped/cancelled is not a failure" rule moved into `lib/status.js` and is shared by the model output, the diagnostics text and the startup card.
- `diagnose`: the text now carries the default scope, `maxResults` / `readMaxChars`, the configured backends, and the first-run `deferred` / error; the `config:` keys come from `CONFIG_FACTS` in `lib/diagnose.js`, so the assembly point follows one contract.
- `config`: `limits.maxResults` is now documented as the default used when `limit` is omitted; the hard cap of 100 does not follow the configuration.
- `page`: zh/en labels now say "personal/work directory" instead of "root", and a new "default search scope" choice is offered.
- `page`: the default scope gets its own row; the four directory fields sit together in a 2×2 grid, and the hint no longer uses the word `scope`.
- `docs`: scope examples use `~/Projects` / `~/Work` instead of Windows drive paths; `es.exe` and path-rewrite examples stay Windows-specific.
- `docs`: model- and page-facing text now says "root" instead of "drive"; Windows drive letters, macOS mounted volumes and Linux `/home` appear only in platform notes and the actual roots in `status`.

## 0.3.1 — 2026-10-31

- `page`: the configuration card no longer disappears when the UI module is missing — a throwing `require('@deepseek-ai/dsh-client-ui-primitives')` used to take the whole browser half with it. It is wrapped in `try`/`catch` now: the card falls back to one line saying this deployment lacks the controls, with the reason in the console, and the tools plus a hand-written profile row keep working. `dsh.client.inject` also no longer lists the primitives module — the shell's module table supplies it, and a name there only orders activation (one without a graph row is skipped), so it was never a hard requirement.
- `page`: a failed startup config write is now shown under the page description instead of only in a log the user never reads — `/api/describe` used to drop `autoconfig.error` (a refused migration lands there too).
- `page`: both backend selectors now carry their own `id`. The DOM used to hold `undefined-everything` / `undefined-anytxt`, which the field's `label` and `aria-controls` both pointed at, and a second registered backend would have collided. A new test pins "every control carries the id and label a browser needs".

## 0.3.0 — 2026-10-31

**Configuration keys moved**: `esPath`, `esEncoding`, `anytxtUrl`, `workspaceRoot`, `workRoot`, `personalRoot`, `allRoots`, `maxResults`, `readMaxChars` leave the top level for `files.*` / `content.*` / `scopes.*` / `limits.*`. At startup the old keys are read into the new shape and cleared; where a home patch overrides the write they stay and the read side keeps honouring them. A 0.2 profile needs no edit.

- `search`: the `engine` argument's `auto` follows the configured `files.backend` / `content.backend` instead of "the first backend in the registry".
- `page`: the page is capability-first — two sections, file names and file contents, each picking a backend by product name and showing that backend's fields; the scopes and limits sections, which do not belong to a backend, stay at the bottom.
- `page`: new `GET /dsh-local-search/api/describe` — the Host supplies the backend list, each backend's fields, types, choices, and hard caps; the page only renders what it gets, so a new backend no longer needs page code.
- `page`: the page no longer carries its own copy of the hard caps; the `maxResults` / `readMaxChars` limits come from describe, the same source as the schema.
- `engines`: first-run autoconfiguration — the absolute `es.exe` path the probe found, plus the address AnyTxt actually answered on (written only when it differs from the default, so an install on `:9921` is recorded), into user-layer fields that are still empty. A complete configuration probes nothing, so there is no extra startup cost. Nothing visible is written; an engine that is down gets one notice in `shell.overlay` per browser session (skipped where the deployment provides no `Toast`).
- `engines`: the first run decides once and stores the hidden `autoConfigured` key with that decision; a field cleared later stays clear instead of being refilled. Startup configuration now runs after the Loader has settled — before that, `settings.describe()` cannot see this row and the migration would be skipped silently.
- `page`: a save validates first — when the address, the `es.exe` path, or a directory in the search scopes changed, the page asks the Host once. A failed check holds the write and the dialog offers "Save anyway"; hard rejections (no file at that path, no such directory, rejected address) get no way out. The Host only checks existence and never starts a file named in the request (`?esPath=` / `?dir=`; out of bounds answers `ES_PATH_REJECTED` / `DIR_REJECTED`).
- `page`: per-field "this page's setting" badges and reset buttons are gone, replaced by one **Reset** entry under the description: it opens a dialog that says what will be cleared, then writes once atomically — engine and limit fields cleared, one probe, `esPath` and the Anytxt address refilled from it, search scopes kept. What a reset touches comes from `describe.reset`; the page does not hard-code it.
- `page`: the column count follows a width query (`matchMedia('(min-width: 656px)')`): two columns from 656px, one below, the block capped at 1100px, so a full-screen window keeps its 2×542 and a ~700px container still gets two columns; a single column caps each cell at 560px instead of running the full width.
- `page`: reset, held saves, and Test connection all go through the primitives' `Modal` — it portals to `document.body` and the shell owns Esc, the Tab trap, and focus restore, so this package still ships no CSS. Deployments without `Modal` fall back to an in-page line (the same rule as `Toast`). Copy is one line; errors use `--dsw-alias-state-error-primary` and links use `--dsw-alias-link` — the warning token this used to name does not exist, and the brand colour is near-neutral in light themes.
- `page`: path-like fields are rewritten to one spelling before a save — drive letter upper-cased, `\` only, repeated and trailing separators collapsed, `allRoots` item by item on `;`, so `d:/alpha/` becomes `D:\alpha`. Only `D:\` and `\\server` prefixes are treated as paths; POSIX forms are left alone, and spaces or non-ASCII names are kept as typed (the Host takes them as values, never through a shell). After the check, the status route returns the on-disk spelling (`d:/alpha` → `D:\Alpha`) and that is what gets stored.
- `page`: the three dialogs were rewritten to "the title says what happened, the body adds only what is new": reset, save-blocked, and engine-unavailable copy never names an engine or a field, so a backend or field-list change needs no copy edit. Test connection is an unordered list, one engine per line (with its version when it passed), each failure carrying its own fix underneath, at the dialog body's size. The in-page "…, nothing was written" line is only for deployments without `Modal`.
- `page`: **Test connection now checks the `es.exe` path in the field** — the draft goes to the Host, so a mistyped path reports "no file at that es.exe path" instead of reporting the saved (or auto-found) one as healthy. The Host still only checks existence and never runs a path from the request.
- `page`: path fields and the Anytxt address are checked on **blur** (paths ask the Host's `?checkOnly=1`, which skips the probe; the address is checked locally for shape, with no request), so typing no longer flashes red. A missing, swapped, or non-local value replaces the field hint in red until the value changes.
- `route`: draft checks tell "missing" from "swapped" — a file where a directory goes is `DIR_NOT_DIRECTORY`, a directory where `es.exe` goes is `ES_PATH_NOT_FILE`, and the page says "this wants a directory, not a file" instead of a vague "not found".
- `page`: field hints are one sentence each: `Complete directory, e.g. D:\Alpha; leave empty to follow the working directory.` and `Local address, e.g. http://127.0.0.1:9920.` — no more `scope=workspace` jargon, and no paragraph about `TextDecoder` labels.
- `page`: the footer note about `timeoutMs` living in the profile YAML is one sentence now.
- `page`: the Test connection states follow the shell's dialog layout: a one-line verdict (no file / address rejected / request failed / testing) goes in `description`, the same slot and size as the reset and save dialogs; the successful list cancels the shell body's fixed 20px top margin with `marginTop:-20px`, so the dialog no longer starts with a gap under the title. Fix lines stay 12px grey.
- `config`: the migration is one "retired paths" table (`RETIRED_PATHS` in `lib/config.js`): the read fallback, the hidden schema keys, and the startup migration all read it, and rows accumulate in release order. So a 0.1 or 0.2 profile jumps straight to the current shape without the intermediate version ever existing; the rule is in `docs/config-migration.md`. The migration moves **only old keys that are really in the user layer** — the schema gives retired paths defaults too, and judging by the configuration would write those defaults into the profile and make the first run think the address was already set, losing the `:9921` discovery.
- `page`: clearing a field is now `unset` (fall back to the profile layer or the default) instead of writing an empty override that shadows the profile; an integer field can be cleared and saved.
- `config`: a startup write that races another change (someone saving in the page during the probe) re-reads the revision and retries once; a failed write leaves its reason in describe's `autoconfig.error` instead of a log line nobody reads. Known limit: after **disabling and re-enabling** the plugin from the market, the host swallows that startup write, so the configuration is completed on the next normal start; restart once after enabling or disabling.
- `docs`: comments are in Chinese (`lib/*.js`, `test/*.test.js`, `scripts/*.mjs`); error text, logs, and schema `description` stay English.
- `privacy`: new `npm run privacy`; CI runs it next to the tests, and a commit is expected to run it too. Real paths go in `test/fixtures/local.*`, which is git-ignored.
- `release`: release bodies are Chinese first, English after, from `docs/releases/TEMPLATE.md`.
- `test`: new `test/describe.test.js` and `test/bootstrap.test.js`; `test/config.test.js` and `test/client.test.js` were rewritten for the nested shape, and `test/route.test.js` covers the describe route. `test/client.test.js` now compares every dictionary key describe hands out and drives the page through hooks that really re-render — a static `useState` stub cannot see an effect that updates state which is also in the dependency array.

## 0.2.1 — 2026-10-29

- `es.exe` exiting 1 with an empty stdout is now `EVERYTHING_DOWN` instead of an empty result: es.exe uses that code both for "nothing matched" and for a dead connection, so a closed Everything window no longer reads as "no files found" while the page's Test control says the engine is down.
- A capped page whose hits were all in `$RECYCLE.BIN` / `System Volume Information` reports "no files found in the returned window (the result set was capped)" instead of a flat "No files found"; the cap is measured on what es.exe returned, before the index filter.
- `local_search_status` reports a cancelled probe as `ABORTED — <CODE>` rather than `DOWN`, so cancellation no longer points at the engine.
- `scope=all` drops roots nested inside another root: AnyTxt is queried once per tree, so overlapping roots no longer double the "x of y" total or flip `truncated` early.
- The configuration page's Test control names the missing link: the probe route reports whether Everything is not installed, installed but not running, or missing `es.exe`, and the page shows the matching one-line fix (the model-facing status keeps its two stable codes). When the install check itself cannot run, it reports `unknown` and keeps the generic hint instead of claiming Everything is absent.
- The hard caps live in `lib/limits.js`; a test now pins the page's copies of the caps and the loopback host list to the Host's own rules.
- The routing prompt is shorter: 447 characters / 61 words to 227 / 28, with the same four decisions, since each tool's own description already carries its purpose.
- Release bodies expand relative links (`../../CHANGELOG.md`) to `blob/<tag>/` URLs when the workflow publishes them, so the repository copy stays readable and the published page stays clickable.

## 0.2.0 — 2026-10-28

- Configuration page as a card in the Plugins page's **Official plugins** group (`plugins.item`, the same shape dsh-github contributes); the card id is the row id, which is what the page resolves the form with.
- Nine fields are now editable there and apply to the next tool call: `esPath`, `esEncoding`, `anytxtUrl`, `workspaceRoot`, `workRoot`, `personalRoot`, `allRoots`, `maxResults`, `readMaxChars`.
- The page lays fields out the way the official settings pages do: sections with a small heading over a responsive field grid, instead of one field per row. The grid seats two columns from 460px up (four path fields read as two rows), and each field sits in a plain wrapper so the field primitive's `.field + .field` separator does not draw inside a cell.
- `esEncoding` is a two-choice control on the page (`gbk` / `utf-8`); the schema keeps accepting any `TextDecoder` label, so a 0.1 profile that wrote `utf8` still activates and the page shows the matching segment.
- New multi-colour `icon.svg` (gradients, no `currentColor`), wired through `package.json` `icon` and the `./icon` export. It shows on the bundle card in Installed plugins, on npm, and in the README; the Official plugins card keeps the page's own default artwork, because that slot resolves icons from a hard-coded map of the four built-in pages.
- `anytxtUrl` must be local (`127.0.0.1`, `localhost`, `[::1]`): both indexes describe this machine, so a remote endpoint would answer with paths that do not resolve here. The rule is enforced by the content engine (`ANYTXT_ENDPOINT_REMOTE`), not at activation, so a 0.1 profile pointing elsewhere still loads and only content search reports it; `maxResults` / `readMaxChars` are range-checked in the schema, so a page write can no longer persist an out-of-range value.
- **Test connection** sits under the Anytxt endpoint, probes the address in the field (no save needed) together with Everything, and answers in one line, through the read-only Host route `GET /dsh-local-search/api/status`; `lib/probe.js` runs the same probe for `local_search_status`. The route refuses cross-site requests and accepts a draft only as a loopback URL; an AnyTXT redirect is refused instead of re-POSTing off-machine. A failing engine links to its official download page — the package never bundles, downloads, or installs either product.
- `lib/config.js` reads a plain snapshot per call, so a saved value is not frozen at activation.
- `timeoutMs` stays profile-YAML only: each tool fixes its deadline at registration.
- The page renders from the shipped UI primitives with no CSS of its own, so UI skins restyle it unchanged.
- New `test/config.test.js`, `test/route.test.js`, and `test/client.test.js`.

## 0.1.0 — 2026-10-28

- Initial native Host plugin.
- `local_search_files` via Everything (`es.exe`), with auto-detection and GBK decoding.
- `local_search_content`, `local_search_fragments`, `local_search_read` via Anytxt JSON-RPC.
- `local_search_status` for both engines.
- `workspace` / `work` / `personal` / `all` scopes; `engine: auto|everything|anytxt`.
- Read-only boundaries: fixed `es.exe` argv, no Anytxt write methods, bounded results.
