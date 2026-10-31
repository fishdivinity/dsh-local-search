<div align="center">

<img src="https://raw.githubusercontent.com/fishdivinity/dsh-local-search/main/icon.svg" width="96" alt="Local Search icon">

# Local Search for DeepSeek Harness

**File names and document text from the whole machine, behind five read-only tools — so the model searches your disk instead of guessing a path.**

[![npm version](https://img.shields.io/npm/v/@fishdivinity/dsh-local-search)](https://www.npmjs.com/package/@fishdivinity/dsh-local-search)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-blue)](#requirements)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--0%20%3C0.3.0-blue)](#requirements)
[![CI](https://img.shields.io/github/actions/workflow/status/fishdivinity/dsh-local-search/ci.yml?branch=main&label=CI)](https://github.com/fishdivinity/dsh-local-search/actions)
[![GitHub stars](https://img.shields.io/github/stars/fishdivinity/dsh-local-search?style=flat)](https://github.com/fishdivinity/dsh-local-search)

[English](README.md) · [简体中文](README-zh.md) · [Install](#install) · [Configuration](#configuration) · [Tools](#tools) · [Security](#security-and-limits)

</div>

## Why this exists

A session sees one folder. `grep` and `glob` are fast inside it and blind outside it, so when the work needs a file that lives anywhere else, the model either guesses a path or stops and asks you for one — and the lookup goes back to you, in another window, with the conversation waiting.

Searching is not the expensive part. Picking the right hit, opening the document, reading the part that matters, putting two of them side by side, and being able to say where the answer came from — that is. It is also exactly what a model is good at, once it can reach an index.

This plugin gives it both: `es.exe` for file and folder **names** wherever Everything has indexed them, Anytxt for the **text inside** PDF, DOCX, XLSX, PPTX, EPUB, RTF, TXT and MD files. The whole surface is read-only — nothing writes, deletes, re-indexes, OCRs or starts an engine.

## When to use it

- **The search is a step, not the goal.** You asked for something else — a summary, a comparison, a fix — and the answer needs a document you cannot point at. Handing that lookup back to yourself costs a window switch and a paste.
- **You know the answer, not the keyword.** "The price clause we agreed with that supplier", "the note about this error". The model can try five phrasings in two languages, read the hits, and come back with the quote and the path.
- **The answer spans files.** "Compare the payment terms in these two contracts", "what did the last three meeting notes decide about the schedule". A search field returns a hit list; the reading and comparing is the part you wanted delegated.
- **The work is batch.** "List the counterparty in each of these 30 contracts" — no search field does this. Search once, read every hit, write the table.
- **The file is not text.** `grep` cannot open a PDF, a `.docx`, or a spreadsheet. Either the text comes through Anytxt, or you paste it in by hand.
- **The answer has to cite a source.** A path plus a snippet can be checked; a plausible paragraph cannot.

## Contents

- [Why this exists](#why-this-exists)
- [When to use it](#when-to-use-it)
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
- [For AI agents](#for-ai-agents)
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
- [Everything](https://www.voidtools.com/) running, plus `es.exe` (a separate download from voidtools; the plugin auto-detects PATH/common install folders, or set `files.everything.esPath`).
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

Sidebar **Plugins** → the **Local Search** card in the **Official plugins** group → the plugin's own page. That is the same card shape the GitHub plugin contributes. Saves apply to the next tool call; leaving the page drops unsaved edits. **Reset**, under the description, first shows what it will clear and only writes once you confirm: the engine and limit settings go, a fresh probe refills them, and the search scopes are left alone because they are paths you typed.

The page is organised by capability: **File names** and **File contents** each open with a backend picker and show that backend's fields once it is selected; **Search scopes** and **Limits** are the same whichever backend runs, so they close the page. The Host's `GET /dsh-local-search/api/describe` supplies the sections, the registered backends, the field types and the hard caps, and the page only renders them, so a new backend does not change the page logic.

**Test connection** sits under the Anytxt endpoint field. It probes the endpoint as typed — nothing has to be saved first — together with Everything, and puts the result and its fix in a dialog that can probe again. The `es.exe` path in the field is checked too, so a typo there says the file is missing instead of reporting the saved binary as OK. A failing engine gets a link to its official download page; this plugin never bundles, downloads, or installs either product.

**A save checks before it writes.** When the endpoint or the `es.exe` path is part of the edit, the page probes them first: whatever the check refuses is not written, and a dialog asks whether to **Save anyway** — a deliberate exception rather than the default. A hard rejection (no file at that path, no such directory, a rejected address) gets no such way out. The Host only checks that the path exists; it never starts a file named by a request. Path fields and the endpoint are also checked when focus leaves them: a missing path, a directory where a file belongs, or a non-local address is flagged under the input and clears as soon as the value changes.

Path fields are rewritten to one standard spelling on save: `d:/alpha` is stored as `D:\alpha` (upper-case drive letter, backslashes, no trailing separator), and `allRoots` is rewritten entry by entry. When the path exists, the on-disk spelling wins (`d:/alpha` → `D:\Alpha`). Spaces and non-ASCII names are left alone — `D:\Alpha\我的项目\drawio a` is fine as typed, because the Host passes values to `es.exe` and the file APIs without going through a shell.

The first run fills what it can and then stops: while `files.everything.esPath` or `content.anytxt.url` is still unset, the plugin probes once, writes what answered, and records that pass in a hidden `autoConfigured` key. After that a field you clear stays clear instead of being filled again.

Every key is optional, and the row config replaces the whole config object rather than merging. Only `timeoutMs` stays in the profile's `cordis.patch.yml`: each tool fixes its deadline when it registers, so the page leaves it out rather than showing a field that would not take effect.

| Key | Default | Meaning |
|---|---|---|
| `files.backend` | `everything` | Filename backend `auto` uses. |
| `files.everything.esPath` | auto-detect | Absolute path to `es.exe`. Resolution order: the configured value, `ES_PATH`, common install folders, `where.exe`. |
| `files.everything.esEncoding` | `gbk` | Code page used to decode `es.exe` output. Any `TextDecoder` label is accepted; the page offers `gbk` and `utf-8`. |
| `content.backend` | `anytxt` | Content backend `auto` uses. |
| `content.anytxt.url` | `http://127.0.0.1:9920` | Anytxt JSON-RPC endpoint on this machine (`127.0.0.1`, `localhost` or `[::1]` only). The default also tries `:9921`. |
| `scopes.workspaceRoot` | session default directory | Root for `scope=workspace`. |
| `scopes.workRoot` | empty | Root for `scope=work`; required before using that scope. |
| `scopes.personalRoot` | empty | Root for `scope=personal`; required before using that scope. |
| `scopes.allRoots` | `C:\` plus `D:\` when present | Semicolon-separated roots for Anytxt `scope=all`. Everything `scope=all` searches all volumes it indexes. |
| `limits.maxResults` | `20` | Default result cap; hard cap 100. |
| `limits.readMaxChars` | `8000` | Default `local_search_read` window; hard cap 20,000 characters. |
| `timeoutMs` | `30000` | Per-call timeout budget; profile YAML only. |

Example row override:

```yaml
- id: fishdivinity-local-search
  name: '@fishdivinity/dsh-local-search'
  config:
    scopes:
      workRoot: 'D:\Projects'
      personalRoot: 'D:\Documents'
    limits:
      maxResults: 50
```

A 0.2 profile needs no hand edit: on startup its nine flat keys (`esPath`, `esEncoding`, `anytxtUrl`, `workspaceRoot`, `workRoot`, `personalRoot`, `allRoots`, `maxResults`, `readMaxChars`) move into the structure above and are removed. When the settings layer refuses that write — a home patch overrides the profile — the old keys stay and are still read.

## Scopes

- `workspace` (default): the session's working directory.
- `work`: `scopes.workRoot`.
- `personal`: `scopes.personalRoot`.
- `all`: `scopes.allRoots` for Anytxt; all indexed volumes for Everything.

Use `all` only when the user explicitly asks for a cross-drive/global search. The `path` argument overrides `scope`.

## Engine selection

`engine` defaults to `auto`, which follows the backend configured for that capability: `files.backend` for `local_search_files`, `content.backend` for `local_search_content`, `fragments`, and `read`.

- `local_search_files`: `auto` or `everything`.
- `local_search_content` / `fragments` / `read`: `auto` or `anytxt`.
- `local_search_status`: `auto`, `everything`, or `anytxt`.

The tool names stay stable if more engines are added; `engine` values are additive. Content items carry both `engine` and a self-describing `ref` such as `anytxt:123`; pass the ref unchanged to `local_search_fragments`/`local_search_read`, and pass `engine` only as an assertion.

## Errors

Failures are typed `HarnessError`s with stable codes:

| Code | Meaning |
|---|---|
| `EVERYTHING_ES_NOT_FOUND` | `es.exe` is missing; install it or set `files.everything.esPath`. |
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

## For AI agents

A session that can only see one folder and is asked about anything else should search instead of guessing. Map the question to a tool:

| Question | Tool | What comes back |
|---|---|---|
| Where is this file? | `local_search_files` | Paths and names, anywhere Everything indexed |
| What does this document say? | `local_search_content` | Matching lines from the text Anytxt extracted, with a `ref` per hit |
| Which part of it? | `local_search_fragments` | Snippets around one match — pass that hit's `ref` unchanged |
| Give me the text | `local_search_read` | Extracted plain text of one file, capped |
| Is the engine even there? | `local_search_status` | Per-engine reachability, before you report "no results" |

- `scope` defaults to `workspace` (the session directory); `work` and `personal` are configured roots; `all` crosses drives and is only for an explicit global search. `path` overrides `scope`.
- Pass a content hit's `ref` back unchanged (`anytxt:123`); `engine` is an assertion to check against, not a selector.
- `EVERYTHING_DOWN` / `ANYTXT_DOWN` mean the engine is not running — fall back to `grep`/`glob` and say you fell back. A down engine is not "no such file".
- Results are capped (`limits.maxResults`, hard 100; `local_search_read` 20,000 characters). Narrow the query instead of paging.
- Every failure carries a stable code from the table above; quote the code, not the prose.
- Windows only, and the engines are installed separately: file-name results cover what Everything indexed, content results cover what Anytxt indexed.

A shorter machine-readable copy of this section is in [`llms.txt`](llms.txt). Terms this package answers to: local search, Everything, `es.exe`, Anytxt, full-text search, PDF / Word / Excel / PowerPoint / EPUB text, cross-drive search, file names outside the workspace.

## Development

No dependencies; tests use Node's built-in test runner.

```powershell
npm test
npm run check
npm run pack:check
```

The engine and config modules (`lib/everything.js`, `lib/anytxt.js`, `lib/roots.js`, `lib/format.js`, `lib/config.js`) are independent of the DSH runtime so their tests run under plain Node. `lib/client.js` ships as the browser half: it is written directly in the client module system's lazy-CJS factory format, so there is no build step. See [`docs/architecture.md`](docs/architecture.md), [`docs/extending-engines.md`](docs/extending-engines.md), [`docs/config-migration.md`](docs/config-migration.md) for the rules a config-shape change has to follow, and [`.github/RELEASING.md`](.github/RELEASING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) (Chinese) or [CHANGELOG.en.md](CHANGELOG.en.md) (English). They stay in the repository; the npm tarball ships only the runtime files, README, LICENSE, locale, and icon.

## License

MIT. Everything and Anytxt are separate products with their own licenses and trademarks; this project is not affiliated with voidtools or CBEWIN.
