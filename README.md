<div align="center">

<img src="https://raw.githubusercontent.com/fishdivinity/dsh-local-search/main/icon.svg" width="96" alt="Local Search icon">

# Local Search for DeepSeek Harness

**File names and document text from the whole machine, behind five read-only tools — so the model searches your disk instead of guessing a path.**

[![npm version](https://img.shields.io/npm/v/@fishdivinity/dsh-local-search)](https://www.npmjs.com/package/@fishdivinity/dsh-local-search)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/fishdivinity/dsh-local-search/)
[![platform](https://img.shields.io/badge/platform-Windows-blue)](#requirements)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--0%20%3C0.3.0-blue)](#requirements)
[![CI](https://img.shields.io/github/actions/workflow/status/fishdivinity/dsh-local-search/ci.yml?branch=main&label=CI)](https://github.com/fishdivinity/dsh-local-search/actions)

[English](README.md) · [简体中文](README-zh.md) · [Install](#install) · [Configuration](#configuration) · [Tools](#tools) · [Security](#security-and-limits)

</div>

## Why this exists

A session sees one folder. `grep` and `glob` are fast inside it and blind outside it, so when the work needs a file that lives anywhere else, the model either guesses a path or stops and asks you for one — and the lookup goes back to you, in another window, with the conversation waiting.

Searching is not the expensive part. Picking the right hit, opening the document, reading the part that matters, putting two of them side by side, and being able to say where the answer came from — that is. It is also exactly what a model is good at, once it can reach an index.

This plugin gives it both: `es.exe` for file and folder **names** wherever Everything has indexed them, Anytxt for the **text inside** PDF, DOCX, XLSX, PPTX, EPUB, RTF, TXT and MD files. The whole surface is read-only — nothing writes, deletes, re-indexes, OCRs or starts an engine. A lookup is answered from the index those engines already built: milliseconds, not a rescan of the drive.

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
- [Errors and diagnostics](#errors-and-diagnostics)
- [Security and limits](#security-and-limits)
- [Known limitations](#known-limitations)
- [How this compares](#how-this-compares)
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

The command writes into one profile, and it has to be the profile the session boots from — the Desktop app owns `desktop`, `dsh web` owns `web`:

```powershell
dsh plugin --profile desktop add @fishdivinity/dsh-local-search   # Desktop app
dsh plugin --profile web add @fishdivinity/dsh-local-search       # dsh web
```

`web` is a shipped template that initializes on first use; `desktop` must have been opened once, and only the `dsh` bundled with the Desktop app can manage it. To install the source instead of the npm tarball, swap the spec for `github:fishdivinity/dsh-local-search`.

Restart the profile or open a new session. The five `local_search_*` tools appear in the model toolset.

## Configuration

Sidebar **Plugins** → the **Local Search** card in the **Official plugins** group → the plugin's own page. That is the same card shape the GitHub plugin contributes. Saves apply to the next tool call; leaving the page drops unsaved edits. **Reset**, under the description, first shows what it will clear and only writes once you confirm: the engine and limit settings go, a fresh probe refills them, and the search scopes plus the startup-check switch are left alone.

The page is organised by capability: **File names** and **File contents** each open with a backend picker and show that backend's fields once it is selected; **Search scopes**, **Limits** and **Startup** are the same whichever backend runs, so they close the page. The Host's `GET /dsh-local-search/api/describe` supplies the sections, the registered backends, the field types and the hard caps, and the page only renders them, so a new backend does not change the page logic.

**Test connection** sits under the Anytxt endpoint field. It probes the endpoint as typed — nothing has to be saved first — together with Everything, and puts the result and its fix in a dialog that can probe again. The `es.exe` path in the field is checked too, so a typo there says the file is missing instead of reporting the saved binary as OK. A failing engine gets a link to its official download page; this plugin never bundles, downloads, or installs either product.

**A save checks before it writes.** When the endpoint or the `es.exe` path is part of the edit, the page probes them first: whatever the check refuses is not written, and a dialog asks whether to **Save anyway** — a deliberate exception rather than the default. A hard rejection (no file at that path, no such directory, a rejected address) gets no such way out. The Host only checks that the path exists; it never starts a file named by a request. Path fields and the endpoint are also checked when focus leaves them: a missing path, a directory where a file belongs, or a non-local address is flagged under the input and clears as soon as the value changes.

Path fields are rewritten to one standard spelling on save: `d:/alpha` is stored as `D:\alpha` (upper-case drive letter, backslashes, no trailing separator), and `allRoots` is rewritten entry by entry. When the path exists, the on-disk spelling wins (`d:/alpha` → `D:\Alpha`). This rewriting only happens on Windows: the page asks the Host for its platform and leaves POSIX-style values alone. Spaces and non-ASCII names are left alone — `D:\Alpha\我的项目\drawio a` is fine as typed, because the Host passes values to `es.exe` and the file APIs without going through a shell. A path may also start with `~/`; it is expanded where it is used, and a save writes back the resolved absolute path.

**Copied diagnostics.** The card has a **Copy diagnostics** button under its description: it opens a dialog with a plain-text snapshot of this machine — plugin and DSH versions, `profile`, `shell`, whether the page runs against a Host on another machine, OS and node, each engine's state with the code that explains it and, when it failed, the address it tried plus the transport error, the configured `es.exe` path, endpoint, encoding, timeout, limits and backends, the search roots with the default scope, the startup-write outcome (including an error), and the probe time. The text carries a heading, a one-line legend for its status tags, and a link to the code table, so a person or another assistant can act on it without the source. Paste it into the chat so the assistant can work through it first; open an [issue](https://github.com/fishdivinity/dsh-local-search/issues) only if that does not solve it. The home directory and `DSH_HOME` are already reduced to `~`. The same text is at `GET /dsh-local-search/api/diagnose`.

**Startup check.** `checkEnginesOnStart` is on by default: every start probes both engines once and, if one fails, leaves a card in the bottom-right corner with one line per engine and what to fix. The card does not remove itself — closing it hides it for this page only, and the switch is how you stop both the probe and the card. **Test connection** and the first-run pass work either way.

The first run fills what it can and then stops: while `files.everything.esPath` or `content.anytxt.url` is still unset, the plugin probes once, writes what answered, and records that pass in a hidden `autoConfigured` key. After that a field you clear stays clear instead of being filled again.

Every key is optional, and the row config replaces the whole config object rather than merging. Only `timeoutMs` stays in the profile's `cordis.patch.yml`: each tool fixes its deadline when it registers, so the page leaves it out rather than showing a field that would not take effect.

| Key | Default | Meaning |
|---|---|---|
| `files.backend` | `everything` | Filename backend `auto` uses. |
| `files.everything.esPath` | auto-detect | Absolute path to `es.exe`. Resolution order: the configured value, `ES_PATH`, common install folders, `where.exe`. |
| `files.everything.esEncoding` | `gbk` | Code page used to decode `es.exe` output. Any `TextDecoder` label is accepted; the page offers `gbk` and `utf-8`. |
| `content.backend` | `anytxt` | Content backend `auto` uses. |
| `content.anytxt.url` | `http://127.0.0.1:9920` | Anytxt JSON-RPC endpoint on this machine (`127.0.0.1`, `localhost` or `[::1]` only). The default also tries `:9921`. |
| `scopes.workspaceRoot` | session default directory | Directory for `scope=workspace`. |
| `scopes.workRoot` | empty | Directory for `scope=work`; required before using that scope. |
| `scopes.personalRoot` | empty | Personal directory for `scope=personal`; required before using that scope. |
| `scopes.allRoots` | empty (automatic) | Semicolon-separated roots for Anytxt `scope=all`; empty uses the platform default roots (drive roots on Windows, mounted volumes on macOS, `/home` on Linux). Everything `scope=all` searches all volumes it indexes. |
| `scopes.defaultScope` | `all` | Scope used when a tool call omits `scope`: `all` / `workspace` / `work` / `personal`. |
| `limits.maxResults` | `20` | Results per call when the tool omits `limit`; hard cap 100, not configurable. |
| `limits.readMaxChars` | `8000` | Default `local_search_read` window; hard cap 20,000 characters. |
| `checkEnginesOnStart` | `true` | Probe both engines once per start and show the failure card. |
| `timeoutMs` | `30000` | Per-call timeout budget; profile YAML only. |

Example row override:

```yaml
- id: fishdivinity-local-search
  name: '@fishdivinity/dsh-local-search'
  config:
    scopes:
      workRoot: '~/Projects'
      personalRoot: '~/Documents'
    limits:
      maxResults: 50
```

A 0.1 or 0.2 profile needs no hand edit: on startup its nine flat keys (`esPath`, `esEncoding`, `anytxtUrl`, `workspaceRoot`, `workRoot`, `personalRoot`, `allRoots`, `maxResults`, `readMaxChars`) move into the structure above and are removed. When the settings layer refuses that write — a home patch overrides the profile — the old keys stay and are still read.

## Scopes

- `all` (default): the whole computer; `scopes.allRoots` for Anytxt (the platform default roots when empty — drive roots on Windows, mounted volumes on macOS, `/home` on Linux), all indexed volumes for Everything.
- `workspace`: the session's working directory.
- `work`: `scopes.workRoot` (work directory).
- `personal`: `scopes.personalRoot` (personal directory).

`scopes.defaultScope` sets which one is used when a tool call omits `scope`; it defaults to `all`. Pass `scope` or `path` only when the user explicitly limits the search.

## Engine selection

`engine` defaults to `auto`, which follows the backend configured for that capability: `files.backend` for `local_search_files`, `content.backend` for `local_search_content`, `fragments`, and `read`.

- `local_search_files`: `auto` or `everything`.
- `local_search_content` / `fragments` / `read`: `auto` or `anytxt`.
- `local_search_status`: `auto`, `everything`, or `anytxt`.

The tool names stay stable if more engines are added; `engine` values are additive. Content items carry both `engine` and a self-describing `ref` such as `anytxt:123`; pass the ref unchanged to `local_search_fragments`/`local_search_read`, and pass `engine` only as an assertion.

## Errors and diagnostics

Every failure is a typed `HarnessError` with a stable code. The code table — what raises each one, what you see, and what to do — lives in [`docs/troubleshooting.md`](docs/troubleshooting.md); it is the only place that explains codes.

A tool call returns the code and a one-line message and nothing else, deliberately: a model that starts installing engines or editing configuration turns one failed search into an environment repair, while the useful move is to fall back to `grep`/`glob` and say it did.

If a search reports `*_DOWN`, fall back to `grep`/`glob` and say that you fell back. The human picture of this machine — versions, `profile`, `shell`, platform, engine states, roots, probe time — is **Copy diagnostics** on the plugin card or `GET /dsh-local-search/api/diagnose`.

## Security and limits

- **Read-only**: no write, delete, index-sync, OCR, export, or settings operation is registered.
- `es.exe` is always spawned with a fixed argv; model text goes after `--`, so `-export-*`, `-save-settings`, `-clear-settings`, `-exit`, `-reindex`, `-save-db`, and run-count switches are unreachable.
- Anytxt is only called through `Search`, `GetResult`, `GetFragmentAll`, and `GetRawTextByFID`.
- No network access except the configured local Anytxt URL.
- Results are capped; `local_search_read` caps the returned text.
- The plugin runs with the user's privileges and can read files the user can read. Search tools default to `all` (every available root); prefer `scope=workspace`/`work`/`personal` or `path` when the search should stay in one tree.

## Known limitations

- The engines are Windows-only today. The scope/path layer is already platform-aware (Windows drive roots, macOS `/Users` + `/Volumes`, Linux `/home`), so labels and roots do not assume drive letters; native backends for macOS/Linux are something we may add later. On those systems the tools still answer but report both engines as unavailable (`missing-tool` / `down`), and the card plus diagnostics name the platform.
- The default scope is `all`: content search queries every default root (up to two RPCs per root). If the configured `allRoots` are all missing (a drive unplugged), the call falls back to the workspace and the result says so; a partially missing root is skipped and named in the result.
- Everything 1.4 indexes metadata, not file contents; use Anytxt for contents.
- Anytxt's JSON-RPC API is local and unofficial; GUI versions can change behavior. The plugin reports unreachable/wrong-shape responses instead of guessing.
- Anytxt's index may be stale. Verify important hits with `read`/the original file.
- No auto-start: starting `ATGUI.exe` writes the index and is left to the user.
- Anytxt's terms limit personal/non-commercial use; commercial use needs its own license.

## How this compares

| | `local_search_files` + `local_search_content` | [`dsh-tool-everything`](https://github.com/roxyyn0304/dsh-tool-everything) | [`dsh-workspace-search`](https://github.com/tsonglew/dsh-workspace-search) |
|---|---|---|---|
| What it reaches | Any path Everything indexed, plus the text inside documents | Any path Everything indexed | Files and text inside one workspace |
| Document text (PDF/DOCX/XLSX/PPTX/EPUB) | Yes, through Anytxt | No | Plain text only |
| Prerequisites | Everything + Anytxt running | Everything running (ships its own SDK DLL) | `dsh-better-sidebar` |

The differentiator is the pair: Anytxt document content, and one routing surface that answers both "where is this file" and "what does this document say".

## For AI agents

A session that can only see one folder and is asked about anything else should search instead of guessing. Map the question to a tool:

| Question | Tool | What comes back |
|---|---|---|
| Where is this file? | `local_search_files` | Paths and names, anywhere Everything indexed |
| What does this document say? | `local_search_content` | Matching lines from the text Anytxt extracted, with a `ref` per hit |
| Which part of it? | `local_search_fragments` | Snippets around one match — pass that hit's `ref` unchanged |
| Give me the text | `local_search_read` | Extracted plain text of one file, capped |
| Is the engine even there? | `local_search_status` | Per-engine reachability, before you report "no results" |

- `scope` defaults to `scopes.defaultScope` (`all` out of the box); `workspace`, `work` and `personal` are explicit narrowings, and `path` overrides `scope`.
- Pass a content hit's `ref` back unchanged (`anytxt:123`); `engine` is an assertion to check against, not a selector.
- `EVERYTHING_DOWN` / `ANYTXT_DOWN` mean the engine is not running — fall back to `grep`/`glob` and say you fell back. A down engine is not "no such file".
- `local_search_status` says whether an engine works, not how to fix it. The fix belongs to the user, in the plugin card; installing or starting an engine is not your call.
- Results are capped (`limits.maxResults` is the default per call, hard 100; `local_search_read` 20,000 characters). Narrow the query instead of paging.
- Every failure carries a stable code from [`docs/troubleshooting.md`](docs/troubleshooting.md); quote the code, not the prose.
- Windows only, and the engines are installed separately: file-name results cover what Everything indexed, content results cover what Anytxt indexed.

A shorter machine-readable copy of this section is in [`llms.txt`](llms.txt). Terms this package answers to: local search, Everything, `es.exe`, Anytxt, full-text search, PDF / Word / Excel / PowerPoint / EPUB text, cross-drive search, file names outside the workspace.

## Development

No dependencies; tests use Node's built-in test runner.

```powershell
npm test
npm run check
npm run pack:check
```

The engine and config modules (`lib/everything.js`, `lib/anytxt.js`, `lib/roots.js`, `lib/platform.js`, `lib/format.js`, `lib/config.js`) are independent of the DSH runtime so their tests run under plain Node. `lib/client.js` ships as the browser half: it is written directly in the client module system's lazy-CJS factory format, so there is no build step. See [`docs/architecture.md`](docs/architecture.md), [`docs/extending-engines.md`](docs/extending-engines.md), [`docs/config-migration.md`](docs/config-migration.md) for the rules a config-shape change has to follow, and [`.github/RELEASING.md`](.github/RELEASING.md).

Adding a language is two files: `lib/locales/<lang>.json` holding exactly the baseline's key set (values only, `.`-separated keys, `{name}` placeholders kept), and `locale/<lang>.json` for the plugin list's title and description. A pack is registered only for a language the shell already ships — the card never adds one to the picker — and `test/client.test.js` fails when a pack's keys or placeholders drift from the baseline. `zh` and `en` stay in the bundle: `apply` cannot wait on a request, and the first frame must not flash another language.

This release ships initial `de`, `es`, `fr`, `ja`, `pt` (Brazilian Portuguese) and `ru` packs — the six ids DSH 0.2.2 introduces. They were proofread against the English baseline; native review is still welcome and replaces a whole file at a time. Ids must match the shell's list exactly (`pt`, not `pt-BR`), otherwise the pack is ignored and the card falls back to English.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) (Chinese) or [CHANGELOG.en.md](CHANGELOG.en.md) (English). They stay in the repository; the npm tarball ships only the runtime files, README, LICENSE, locale, and icon.

## License

MIT. Everything and Anytxt are separate products with their own licenses and trademarks; this project is not affiliated with voidtools or CBEWIN.
