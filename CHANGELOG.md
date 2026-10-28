# Changelog

## Unreleased

- Add a Plugins-page configuration form (Client half + `plugins.row.config`).
- Add a Host status/test remote for that form.
- Consider Windows Search and Recoll providers behind the existing `engine` values.

## 0.1.0 — 2026-10-28

- Initial native Host plugin.
- `local_search_files` via Everything (`es.exe`), with auto-detection and GBK decoding.
- `local_search_content`, `local_search_fragments`, `local_search_read` via Anytxt JSON-RPC.
- `local_search_status` for both engines.
- `workspace` / `work` / `personal` / `all` scopes; `engine: auto|everything|anytxt`.
- Read-only boundaries: fixed `es.exe` argv, no Anytxt write methods, bounded results.
