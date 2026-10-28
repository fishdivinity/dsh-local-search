# Publishing

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

For v0.1.0 the workflow sees that the version is already on npm, skips the publish step, and creates the GitHub Release. Later tags publish normally.

## One-time: configure npm trusted publishing

After v0.1.0 exists:

1. Open the package on npmjs.com → **Settings** → **Trusted publishing**.
2. Add a **GitHub Actions** publisher:
   - Organization/user: `fishdivinity`
   - Repository: `dsh-local-search`
   - Workflow filename: `release.yml`
   - Environment: leave empty
3. No long-lived npm token or `NPM_TOKEN` secret is needed.

## Later releases (agent can do this)

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Run `npm test`, `npm run check`, and `npm run pack:check`.
3. Commit and push `main`.
4. Tag and push:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

The `Release` workflow verifies tag/version, runs tests, publishes with provenance via OIDC, and creates the GitHub Release. This is the durable path: it does not require an OTP per release and stores no npm token in the repository or in the agent environment.

## Direct local token (not recommended)

A granular access token with **Bypass 2FA** can let a local agent publish, but npm is phasing out direct publishing with bypass tokens. If used, keep it in the user-level `~/.npmrc` (for example `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`) or a CI secret, never in this repository, never in chat, and never in a session log.
