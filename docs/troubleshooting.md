# Troubleshooting

Every code this plugin can hand out is explained here, once: what produced it, what you see, and what fixes it. That is the whole map — a reader holding a code needs nothing else.

The two surfaces that hand codes out are different on purpose. The model only ever receives a code and a message, so it is told what is unavailable and falls back to `grep` / `glob`; it is never told how to install or start an engine, because an agent that starts fixing the environment turns one failed search into an incident. A person can copy the machine's whole state — versions, platform, profile, the four scopes, and when the probe ran — from `GET /dsh-local-search/api/diagnose`, which is what makes an issue report actionable without a screenshot.

## Parameters

| Code | Produced by | What you see | Fix |
|---|---|---|---|
| `INVALID_ARGUMENT` | tool entry, `es.exe` and Anytxt backends | The call is refused before any search starts: empty `query`, a `limit` that is not a positive integer, or an empty `ref`. | Call again with a non-empty query and `limit` ≥ 1; pass a content result's `ref` back unchanged. |
| `INVALID_SCOPE` | scope resolution | `scope` is not one of `workspace`, `work`, `personal`, `all`. | Use one of those four names, or omit `scope` to search the workspace. |
| `SCOPE_NOT_CONFIGURED` | scope resolution | The chosen scope has no directory behind it: `workRoot` or `personalRoot` is unset. For `all`, configured roots that are all missing fall back to the workspace instead. | Set that scope's directory on the plugin card, or pass an explicit `path` on the call. |
| `ROOT_NOT_ABSOLUTE` | scope resolution, `es.exe` search | A scope path or an explicit `path` is relative or empty. | Write an absolute directory (`D:\Alpha`, `/home/me/alpha`, or `~/alpha`, which expands against the user's home). |
| `ROOT_NOT_FOUND` | scope resolution, `es.exe` search | The directory does not exist: deleted, another drive letter, or a typo. | Point the field at a directory that is there, and check the drive is mounted. |
| `ROOT_NOT_DIRECTORY` | scope resolution | The path exists but is a file. | Use the directory the file lives in. |
| `WORKSPACE_UNAVAILABLE` | tool entry | The session's working directory could not be read, so `workspace` has nothing to search. | Set `scopes.workspaceRoot`, or pass an explicit `path`. |
| `INVALID_REF` | ref parsing | `ref` is empty, is not `<engine>:<id>`, or names an engine that is not registered here. | Use the `ref` string from the latest `local_search_content` result; refs are not portable between engines. |

## Engines

| Code | Produced by | What you see | Fix |
|---|---|---|---|
| `EVERYTHING_ES_NOT_FOUND` | Everything backend | `es.exe` was not found — not at the configured path, not named by `ES_PATH` or `PATH`, and not in the usual install directories. | Install Everything, keep `es.exe` (the command-line tool, not `Everything.exe`) beside it, then set **es.exe path** on the plugin card. |
| `EVERYTHING_DOWN` | Everything backend | `es.exe` is there but did not start, exited non-zero, or the version probe returned nothing: Everything itself is not running. | Start Everything from the tray, then press **Test connection** on the card. |
| `EVERYTHING_TIMEOUT` | Everything backend | The search did not finish within `timeoutMs`. | Narrow the query, or raise `timeoutMs` in the profile. |
| `EVERYTHING_TOO_LARGE` | Everything backend | The output passed 8 MB, which means the query matched far more than a person can use. | Narrow the query — a path, a longer term, or a different scope. |
| `EVERYTHING_BAD_OUTPUT` | Everything backend | `es.exe` printed something that is not the JSON this plugin reads: usually a different binary, or the wrong `esEncoding`. | Point **es.exe path** at the official tool, and set the encoding (`gbk` / `utf-8`) to match the system. |
| `EVERYTHING_ABORTED` | Everything backend | The call was cancelled — a tool deadline, or the client went away. The index is not broken. | Retry; if a broad query keeps reaching the deadline, narrow it. |
| `ANYTXT_ENDPOINT_REMOTE` | Anytxt backend | The configured address is not loopback. | Use `http://127.0.0.1:<port>` — both indexes only describe the machine the Host runs on. |
| `ANYTXT_DOWN` | Anytxt backend | Nothing answered on the JSON-RPC port. An index service that is running with the Anytxt window closed counts here. | Start `ATGUI.exe` and leave it in the tray, check the **address** on the card, then press **Test connection**. When `ATGUI.exe` is not found in the usual install folders the card cannot tell "not running" from "not installed" and offers the download page instead of that sentence. |
| `ANYTXT_TIMEOUT` | Anytxt backend | The RPC did not answer within `timeoutMs`. | Retry; raise `timeoutMs`; let a running index rebuild finish. |
| `ANYTXT_HTTP` | Anytxt backend | The address answered with an HTTP error such as 404 or 500. | Check the port: the Anytxt JSON-RPC service has to be the one listening there. |
| `ANYTXT_RPC` | Anytxt backend | The service answered, but with a JSON-RPC error or without the result this plugin reads. | Read the message; it is usually the wrong Anytxt version, or a query the index refused. |
| `ANYTXT_BAD_OUTPUT` | Anytxt backend | The answer was not JSON, or not the object shape expected — something else is listening on that port. | Point the address at Anytxt's JSON-RPC port. |
| `ANYTXT_ABORTED` | Anytxt backend | The call was cancelled. The index is not broken. | Retry. |
| `ENGINE_UNSUPPORTED` | engine registry | `engine` names a backend this install does not have. | Use `auto`, or a name the plugin card lists. |
| `ENGINE_READ_UNSUPPORTED` | tool entry | The backend behind `ref` has no fragments or full-text operation — it only returns search hits. | Search with another backend, or open the file with a file tool. |

## Routes

These codes answer the page's own read-only requests, not the tools. The card turns each one into the sentence it prints under a field or in a dialog, so the fix is always the same shape: correct the value and press again.

| Code | Produced by | What you see | Fix |
|---|---|---|---|
| `ES_PATH_REJECTED` | draft check route (`?esPath=`) | The draft path is not an absolute existing file, and the answer is HTTP 400. | Correct the field to the `es.exe` that exists. |
| `ES_PATH_NOT_FILE` | draft check route (`?esPath=`) | The draft path exists but is a directory. | Point at `es.exe` itself, not at its folder. |
| `DIR_REJECTED` | draft check route (`?dir=`) | A draft scope directory is not absolute or does not exist (HTTP 400). | Correct the scope path; the card marks the field before anything is saved. |
| `DIR_NOT_DIRECTORY` | draft check route (`?dir=`) | A draft scope path exists but is a file. | Use a directory. |
| `ANYTXT_URL_REJECTED` | draft check route (`?anytxtUrl=`) | The draft address is not a loopback `http(s)` URL (HTTP 400). | Use `http://127.0.0.1:<port>`. |
| `CROSS_SITE_REFUSED` | every read-only route (status, describe, diagnose, locales) | The request did not come from this Host's page (HTTP 403): another site, or a request whose origin is not this Host. | Open the plugin card from this Host; do not call these routes from another origin. |
| `PROBE_FAILED` | status and diagnose routes | The probe itself threw, and the answer is HTTP 500. | Press **Test connection** or **Copy diagnostics** again; if it repeats, paste the diagnostics text into an issue. |

## Settings

| Code | Produced by | What you see | Fix |
|---|---|---|---|
| `SETTINGS_CONFLICT` | settings write-back at startup | The write lost a revision race with another writer, usually a save from the card at the same moment. | The startup pass retries once by itself; save once from the card. If it keeps happening, something else is editing the profile file. |

## Fallback

| Code | Produced by | What you see | Fix |
|---|---|---|---|
| `LOCAL_SEARCH_ERROR` | tool error wrapper | A failure that is not an engine error; the original message is passed through unchanged. | Read the message; if it names nothing actionable, paste the diagnostics text into an issue. |
