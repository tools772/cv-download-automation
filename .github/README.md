# GitHub Actions — Windows installer

Workflow: [build-windows-installer.yml](./workflows/build-windows-installer.yml)

## Required repository secrets

Add in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|--------|
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` in the ATS portal (e.g. `https://xxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Same as `VITE_SUPABASE_ANON_KEY` in the ATS portal |

These are embedded in the installer at build time (anon key only — same as the public portal client).

## Run the workflow

### Manual

1. Push this repo to GitHub
2. **Actions** → **Build Windows installer** → **Run workflow**

### On release tag

Push a version tag to auto-build and attach the `.exe` to a GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Download the .exe

After a successful run:

1. Open the workflow run in **Actions**
2. **Artifacts** → **perfect-ventures-fetch-agent-windows-exe**
3. Unzip → `Perfect Ventures Fetch Agent Setup *.exe`

For tag builds, the `.exe` is also on the **Releases** page.

## Local Windows build (optional)

```bash
npm run build:exe -- --portal-env ../ats-perfect-ventures/.env.local
```
