# GitHub Actions — Build installers

Uses **electron-builder** (configured in root `package.json` → `"build"`).

Workflow: [build.yml](./workflows/build.yml)

## What it builds

| Runner | Output |
|--------|--------|
| `windows-latest` | NSIS `.exe` |
| `macos-latest` | `.dmg` |

Artifacts are uploaded per platform. Tag pushes (`v*`) also create a GitHub Release with both installers attached.

## Required secrets (build time)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Embedded in installer (`config/team.defaults.env`) |
| `SUPABASE_ANON_KEY` | Same as portal anon key |

Add under **Settings → Secrets and variables → Actions**.

The workflow fails immediately if either secret is missing.

## Trigger a build

### Manual

**Actions** → **Build installers** → **Run workflow**

### Release (both .exe + .dmg on Release page)

```bash
git tag v0.1.0
git push origin v0.1.0
```

Bump `version` in `package.json` before tagging when releasing a new version.

## Download artifacts

- **Manual run:** open the workflow run → **Artifacts** → `fetch-agent-installer-windows` / `fetch-agent-installer-macos`
- **Tag run:** **Releases** → pick the tag → download assets

## Local builds (same as CI)

```bash
npm ci
npm run prepare:bundle -- --portal-env ../ats-perfect-ventures/.env.local
npm run dist:win   # Windows only
npm run dist:mac   # macOS only
npm run dist       # current OS only
```

Or one step with env vars:

```bash
export SUPABASE_URL=...
export SUPABASE_ANON_KEY=...
npm ci && npm run prepare:bundle && npm run dist:mac
```

## Future secrets (code signing — not configured yet)

When you enable signing later, add:

| Secret | Platform | Purpose |
|--------|----------|---------|
| `APPLE_CERTIFICATE_BASE64` | macOS | Developer ID Application `.p12` (base64) |
| `APPLE_CERTIFICATE_PASSWORD` | macOS | Certificate password |
| `APPLE_ID` | macOS | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password |
| `APPLE_TEAM_ID` | macOS | Team ID |
| `WINDOWS_CERTIFICATE_BASE64` | Windows | Code signing `.pfx` (base64) |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | Certificate password |

Then update `package.json` `"build"` mac/win signing options and the workflow to import certificates before `electron-builder` runs.

Installers currently build **unsigned** (`forceCodeSigning: false`, `identity: null`).
