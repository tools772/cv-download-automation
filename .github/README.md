# GitHub Actions — Build installers

Uses **electron-builder** (configured in root `package.json` → `"build"`).

Workflow: [build.yml](./workflows/build.yml)

## What it builds

| Runner | Output |
|--------|--------|
| `windows-latest` | NSIS `.exe` |
| `macos-latest` | `.dmg` |

Artifacts are uploaded per platform. Tag pushes (`v*`) also create a GitHub Release with both installers attached.

## Branch → Environment mapping

One workflow for both branches. The job selects a GitHub Environment from the ref so installers embed the matching Supabase project:

| Trigger | GitHub Environment | Secrets used |
|---------|--------------------|--------------|
| Push / dispatch on `dev` | `dev` | Environment secrets for the **dev** Supabase project |
| Push / dispatch on `main` | `main` | Environment secrets for the **prod** Supabase project |
| Tag `v*` | `main` | Same as `main` (production release) |

Secret **names** are identical in both environments; only the values differ.

## Required secrets (per environment)

Create Environments named **`dev`** and **`main`** under **Settings → Environments**, then add the same secret names to each:

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Embedded in installer (`config/team.defaults.env`) |
| `SUPABASE_ANON_KEY` | Same as portal anon key for that project |

Do **not** put these in repository-level Actions secrets if you want branch-specific builds — use Environment secrets so `dev` and `main` resolve different Supabase projects.

The workflow fails immediately if either secret is missing from the selected environment.

## Trigger a build

### Automatic (branch push)

Push to `dev` or `main` runs the workflow with that branch’s environment.

### Manual

**Actions** → **Build installers** → **Run workflow** (pick the branch; that branch selects the environment).

### Release (both .exe + .dmg on Release page)

```bash
git tag v0.1.0
git push origin v0.1.0
```

Bump `version` in `package.json` before tagging when releasing a new version. Tag builds use the **`main`** environment.

## Download artifacts

- **Manual / branch run:** open the workflow run → **Artifacts** → `fetch-agent-installer-windows` / `fetch-agent-installer-macos`
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
