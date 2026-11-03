# Contributing

## Development

```powershell
npm test          # node --test
npm run check     # node --check on every lib module
npm run pack:check
```

No runtime dependencies are installed. Engine modules under `lib/` are plain ESM and are unit-tested under Node.

## Rules

- Keep the plugin read-only. Do not add Anytxt `SyncIndex`, `OCR`, or any `es.exe` state-changing switch.
- Keep `es.exe` argv fixed; model text stays after `--`.
- Add tests for new engine parsing, error codes, and bounds.
- Update `README.md`, `README-zh.md`, and `CHANGELOG.md` for user-visible changes.
- Use the `local_search_*` tool prefix; add engines behind the `engine` parameter rather than new tool families.
- Comments follow [`docs/comments.md`](docs/comments.md): keep a block within its limit and point only at files that ship in this repository, never at a local-only path. `test/comments.test.js` turns those two rules into a failing test, so a red run means shorten the comment or move the detail into `docs/`; if the rule itself looks wrong, open an issue instead of working around the check.

## Local install while developing

```powershell
dsh plugin --profile <profile> add <absolute-path-to-this-repo>
```

Or, from an agent session with plugin management, install this directory as a bundle.

Release process: [`.github/RELEASING.md`](.github/RELEASING.md).
