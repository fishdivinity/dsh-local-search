# Changelog

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
