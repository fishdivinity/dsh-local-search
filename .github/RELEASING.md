# Releasing

## One-time: enable npm 2FA

Publishing to npm requires two-factor authentication or a granular token with bypass 2FA. For a human-operated account, enable **Authorization and writes** (`auth-and-writes`), not just `auth-only`:

1. Sign in at <https://www.npmjs.com>.
2. Account settings → **Two-Factor Authentication** → **Enable 2FA**.
3. Choose **Authorization and writes**, scan the QR code with an authenticator app, and store the recovery codes.
4. Confirm the account now reports `tfa: auth-and-writes`:

```powershell
npm profile get --json --registry=https://registry.npmjs.org
```

`npm login` alone does not enable 2FA; it is a separate account setting.

## First publish (manual, v0.1.0)

The package must exist on npm before a trusted publisher can be configured. From the repository:

```powershell
npm publish --access public --registry=https://registry.npmjs.org
```

Enter the current OTP when prompted. Verify:

```powershell
npm view @fishdivinity/dsh-local-search version --registry=https://registry.npmjs.org
```

Then configure trusted publishing (below), and create the tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

For v0.1.0 the workflow sees that the version is already on npm, skips the publish step, and creates or updates the GitHub Release from `docs/releases/v0.1.0.md`. Later tags publish normally.

## One-time: configure npm trusted publishing

After v0.1.0 exists:

1. Open the package on npmjs.com → **Settings** → **Trusted publishing**.
2. Add a **GitHub Actions** publisher:
   - Organization/user: `fishdivinity`
   - Repository: `dsh-local-search`
   - Workflow filename: `release.yml`
   - Environment: leave empty
3. No long-lived npm token or `NPM_TOKEN` secret is needed.

## Release notes (required)

Every release tag must have `docs/releases/<tag>.md` (for example `docs/releases/v0.1.1.md`). The workflow fails before publishing if the file is missing, so the GitHub Release never falls back to a generated commit link.

Start from [`docs/releases/TEMPLATE.md`](../docs/releases/TEMPLATE.md) and follow its order:

- Chinese first, English after; both halves say the same thing;
- five sections per half: 这版做了什么 / 怎么做到的 / 升级 / 兼容 / 完整变更 (`What changed` / `How` / `Upgrade` / `Compatibility` / `Full changelog`);
- a summary, not an itemised list: the changelog is the full record, so the two must not restate each other;
- each half links its own changelog: `../../CHANGELOG.md` after the Chinese one, `../../CHANGELOG.en.md` after the English one. The workflow expands them to `blob/<tag>/…`, and it refuses a body that still points at `main`.

## Changelogs

`CHANGELOG.md` is Chinese, `CHANGELOG.en.md` is English; both list the same versions. Entries up to 0.2.1 stay as they shipped (English); from 0.3.0 on, write the entry in both files in the same commit.

Neither file may grow without bound. Cut when a file passes ~200 lines **or** the tree crosses five minors (0.1.0…0.4.0 is five): move the two oldest versions out of both files, in the same commit, into `docs/CHANGELOG-archive.md` and `docs/CHANGELOG-archive.en.md`, and leave one line at the bottom of each root file pointing at its archive. Cut only on `main`: every tag keeps its own snapshot, which is why published release links stay valid.

## Later releases (agent can do this)

1. Bump `version` in `package.json`, add the entry to `CHANGELOG.md` **and** `CHANGELOG.en.md`, and add `docs/releases/vX.Y.Z.md`.
   The entry's heading date is the **release day**, not the day the work started: set it in the release commit, after the last code change.
2. Run `npm test`, `npm run check`, `npm run privacy`, and `npm run pack:check`. CI runs the same four.
3. Commit and push `main`.
4. Tag and push:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

The `Release` workflow verifies tag/version, runs tests, publishes with provenance via OIDC, and creates the GitHub Release. This is the durable path: it does not require an OTP per release and stores no npm token in the repository or in the agent environment.

## Direct local token (not recommended)

A granular access token with **Bypass 2FA** can let a local agent publish, but npm is phasing out direct publishing with bypass tokens. If used, keep it in the user-level `~/.npmrc` (for example `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`) or a CI secret, never in this repository, never in chat, and never in a session log.
