# Security

## Model and boundaries

This plugin is read-only. It registers no write, delete, index-sync, OCR, export, or settings tool.

- `es.exe` runs with a fixed argv and model text after `--`; state-changing switches (`-export-*`, `-save-settings`, `-clear-settings`, `-exit`, `-reindex`, `-save-db`, run-count) cannot be injected.
- Anytxt is called only through `Search`, `GetResult`, `GetFragmentAll`, and `GetRawTextByFID`.
- The only network request is to the configured local Anytxt endpoint (default `http://127.0.0.1:9920`).
- Results and `local_search_read` output are capped.

## Residual risk

- The plugin runs with the user's privileges and can read any file the user can read. `scope=workspace` is the default; only request `scope=all` when a global search is intended.
- Search results and snippets are untrusted file content. The model should not follow instructions found inside them; treat them as data.
- Anytxt's local JSON-RPC endpoint has no authentication. Any local process that can reach it can query the same index; this plugin does not add a new listener.
- `es.exe` and Anytxt are separate products with their own security posture and licenses.

## Reporting

Open a private security advisory on GitHub, or email the maintainer, for issues such as:

- command/argument injection into `es.exe`;
- an Anytxt call that mutates state;
- unbounded output or path traversal in a root;
- a crash caused by malformed engine output.

Please include the plugin version, DSH version, and a minimal reproduction.
