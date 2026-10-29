<div align="center">

<img src="https://raw.githubusercontent.com/fishdivinity/dsh-local-search/main/icon.svg" width="96" alt="Local Search icon">

# Local Search for DeepSeek Harness

**Read-only Everything filename search and Anytxt document-content search, behind one capability-based tool surface.**

[![npm version](https://img.shields.io/npm/v/@fishdivinity/dsh-local-search)](https://www.npmjs.com/package/@fishdivinity/dsh-local-search)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-blue)](#requirements)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--0%20%3C0.3.0-blue)](#requirements)
[![CI](https://img.shields.io/github/actions/workflow/status/fishdivinity/dsh-local-search/ci.yml?branch=main&label=CI)](https://github.com/fishdivinity/dsh-local-search/actions)
[![GitHub stars](https://img.shields.io/github/stars/fishdivinity/dsh-local-search?style=flat)](https://github.com/fishdivinity/dsh-local-search)

[English](README.md) · [简体中文](README-zh.md) · [Install](#install) · [Configuration](#configuration) · [Tools](#tools) · [Security](#security-and-limits)

</div>

## Contents

- [Tools](#tools)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [Scopes](#scopes)
- [Engine selection](#engine-selection)
- [Errors](#errors)
- [Security and limits](#security-and-limits)
- [Known limitations](#known-limitations)
- [Related plugins](#related-plugins)
- [Development](#development)
- [License](#license)

## Tools

| Tool | Engine | Use for |
|---|---|---|
| `local_search_files` | Everything via `es.exe` | File/folder names, paths, cross-drive discovery |
| `local_search_content` | Anytxt JSON-RPC | Text inside PDF, DOCX, XLSX, PPTX, EPUB, RTF, TXT, MD |
| `local_search_fragments` | Anytxt | Snippets around a match in one indexed file |
| `local_search_read` | Anytxt | Extracted plain text of one indexed file, capped |
| `local_search_status` | both | Check whether each engine is reachable |

## Requirements

- Windows.
- DeepSeek Harness `>=0.2.1-0 <0.3.0`.
- [Everything](https://www.voidtools.com/) running, plus `es.exe` (a separate download from voidtools; the plugin auto-detects PATH/common install folders, or set `esPath`).
- [Anytxt Searcher](https://anytxt.net/) for content search: the **GUI** (`ATGUI.exe`) must be running because the JSON-RPC service lives inside it. The indexing service alone is not enough.

This plugin does **not** bundle Everything, `es.exe`, or Anytxt. Install and license them separately.

## Install

```powershell
dsh plugin --profile desktop add @fishdivinity/dsh-local-search
```

From GitHub before the first npm release:

```powershell
dsh plugin --profile desktop add github:fishdivinity/dsh-local-search
```

Restart the profile or open a new session. The five `local_search_*` tools appear in the model toolset.

## Configuration

Sidebar **Plugins** → the **Local Search** card in the **Official plugins** group → the plugin's own page. That is the same card shape the GitHub plugin contributes. Saves apply to the next tool call; leaving the page drops unsaved edits, and a field's reset returns it to the profile layer.

**Test connection**, directly under the Anytxt endpoint, probes that address as typed — nothing has to be saved first — together with Everything, and answers in one line. A failing engine gets a link to its official download page; this plugin never bundles, downloads, or installs either product.

Every key is optional, and the row config replaces the whole config object rather than merging. Only `timeoutMs` stays in the profile's `cordis.patch.yml`: each tool fixes its deadline when it registers, so the page leaves it out rather than showing a field that would not take effect.

| Key | Default | Meaning |
|---|---|---|
| `esPath` | auto-detect | Absolute path to `es.exe`. Resolution order: `esPath`, `ES_PATH`, common install folders, `where.exe`. |
| `anytxtUrl` | `http://127.0.0.1:9920` | Anytxt JSON-RPC endpoint on this machine (`127.0.0.1`, `localhost` or `[::1]` only). The default also tries `:9921`. |
| `workspaceRoot` | session default directory | Root for `scope=workspace`. |
| `workRoot` | empty | Root for `scope=work`; required before using that scope. |
| `personalRoot` | empty | Root for `scope=personal`; required before using that scope. |
| `allRoots` | `C:\` plus `D:\` when present | Semicolon-separated roots for Anytxt `scope=all`. Everything `scope=all` searches all volumes it indexes. |
| `maxResults` | `20` | Default result cap. Hard cap is 100. |
| `timeoutMs` | `30000` | Per-call timeout budget; profile YAML only. |
| `readMaxChars` | `8000` | Default `local_search_read` window; hard cap is 20,000 characters. |
| `esEncoding` | `gbk` | Code page used to decode `es.exe` output. The page offers `gbk` and `utf-8` as a two-choice control. |

Example row override:

```yaml
- id: fishdivinity-local-search
  name: '@fishdivinity/dsh-local-search'
  config:
    workRoot: 'D:\Projects'
    personalRoot: 'D:\Documents'
    allRoots: 'C:\;D:\'
```

## Scopes

- `workspace` (default): the session's working directory.
- `work`: `workRoot`.
- `personal`: `personalRoot`.
- `all`: `allRoots` for Anytxt; all indexed volumes for Everything.

Use `all` only when the user explicitly asks for a cross-drive/global search. The `path` argument overrides `scope`.

## Engine selection

`engine` defaults to `auto`:

- `local_search_files`: `auto` or `everything`.
- `local_search_content` / `fragments` / `read`: `auto` or `anytxt`.
- `local_search_status`: `auto`, `everything`, or `anytxt`.

The tool names stay stable if more engines are added; `engine` values are additive. Content items carry both `engine` and a self-describing `ref` such as `anytxt:123`; pass the ref unchanged to `local_search_fragments`/`local_search_read`, and pass `engine` only as an assertion.

## Errors

Failures are typed `HarnessError`s with stable codes:

| Code | Meaning |
|---|---|
| `EVERYTHING_ES_NOT_FOUND` | `es.exe` is missing; install it or set `esPath`. |
| `EVERYTHING_DOWN` | Everything is not running / cannot be reached. |
| `EVERYTHING_TIMEOUT`, `EVERYTHING_TOO_LARGE` | Query too broad or slow; narrow it. |
| `ANYTXT_DOWN` | Anytxt GUI is not running or the JSON-RPC endpoint is unreachable. |
| `ANYTXT_TIMEOUT`, `ANYTXT_RPC`, `ANYTXT_HTTP` | Anytxt-side query/transport failure. |
| `ROOT_NOT_FOUND`, `SCOPE_NOT_CONFIGURED`, `INVALID_SCOPE` | Root/scope configuration problem. |
| `INVALID_ARGUMENT` | Empty query, bad limit, etc. |

If a search reports `*_DOWN`, fall back to `grep`/`glob` and say that you fell back.

## Security and limits

- **Read-only**: no write, delete, index-sync, OCR, export, or settings operation is registered.
- `es.exe` is always spawned with a fixed argv; model text goes after `--`, so `-export-*`, `-save-settings`, `-clear-settings`, `-exit`, `-reindex`, `-save-db`, and run-count switches are unreachable.
- Anytxt is only called through `Search`, `GetResult`, `GetFragmentAll`, and `GetRawTextByFID`.
- No network access except the configured local Anytxt URL.
- Results are capped; `local_search_read` caps the returned text.
- The plugin runs with the user's privileges and can read files the user can read. Prefer `scope=workspace` unless a global search is requested.

## Known limitations

- Windows only.
- Everything 1.4 indexes metadata, not file contents; use Anytxt for contents.
- Anytxt's JSON-RPC API is local and unofficial; GUI versions can change behavior. The plugin reports unreachable/wrong-shape responses instead of guessing.
- Anytxt's index may be stale. Verify important hits with `read`/the original file.
- No auto-start: starting `ATGUI.exe` writes the index and is left to the user.
- Anytxt's terms limit personal/non-commercial use; commercial use needs its own license.

## Related plugins

- [`dsh-tool-everything`](https://dshbase.com/zh/plugins/dsh-tool-everything/) covers Everything filename search through the SDK.
- [`dsh-workspace-search`](https://github.com/tsonglew/dsh-workspace-search) covers workspace file names/contents in the sidebar.
- This plugin's differentiator is Anytxt document content plus one routing surface for names and contents.

## Development

No dependencies; tests use Node's built-in test runner.

```powershell
npm test
npm run check
npm run pack:check
```

The engine and config modules (`lib/everything.js`, `lib/anytxt.js`, `lib/roots.js`, `lib/format.js`, `lib/config.js`) are independent of the DSH runtime so their tests run under plain Node. `lib/client.js` ships as the browser half: it is written directly in the client module system's lazy-CJS factory format, so there is no build step. See [`docs/architecture.md`](docs/architecture.md), [`docs/extending-engines.md`](docs/extending-engines.md), and [`.github/RELEASING.md`](.github/RELEASING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md). It stays in the repository; the npm tarball ships only the runtime files, README, LICENSE, locale, and icon.

## License

MIT. Everything and Anytxt are separate products with their own licenses and trademarks; this project is not affiliated with voidtools or CBEWIN.
