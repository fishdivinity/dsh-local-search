# Changelog

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
