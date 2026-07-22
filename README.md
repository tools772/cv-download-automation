# Perfect Ventures Fetch Agent

Local desktop agent for **Instahyre** and **Naukri** CV fetch.

**Recruiters:** open **[START_HERE.md](./START_HERE.md)** — install, login once, start agent.

## Quick start (terminal)

```bash
npm run install:agent    # setup + npm install
npm run login-instahyre  # once
npm run login-naukri     # once
npm start                # keep running while fetching
```

Mac: double-click **`Install Fetch Agent.command`**, then **`Start Fetch Agent.command`**.

Windows: run **`install-fetch-agent.bat`**, then **`start-fetch-agent.bat`**.

## Package for recruiters

**Desktop app (recommended):** build `.dmg` locally / `.exe` via GitHub Actions → **`recruiter/installers/`** — see **[recruiter/INSTALLERS.md](./recruiter/INSTALLERS.md)** and **[`.github/README.md`](./.github/README.md)**

```bash
npm run build:dmg -- --portal-env ../ats-perfect-ventures/.env.local   # Mac
# Windows .exe → GitHub Actions → Build Windows installer
```

**Zip (CLI + Node.js):**

```bash
npm run package:recruiter -- --portal-env ../ats-perfect-ventures/.env.local
```

## Config

| File | Purpose |
|------|---------|
| `.env.local` | Per-machine config (gitignored) |
| `config/team.defaults.env` | Bundled in release zip (Supabase shared) |

Only three values matter:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
COMPANION_PORTAL_USER_EMAIL=you@perfect.ventures
```

No Naukri/Instahyre passwords — manual browser login saves sessions under `~/PerfectVentures/`.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run install:agent` | First-time setup + install deps |
| `npm run setup` | Create/update `.env.local` only |
| `npm start` | Poll Supabase, run fetch jobs |
| `npm run login-instahyre` | Manual Instahyre login |
| `npm run login-naukri` | Manual Naukri login |
| `npm run package:release` | Build distributable zip |

## How it connects to the portal

```
ATS portal  →  fetch_jobs (Queued)
Fetch Agent →  poll → Playwright → Google Drive
Portal tab  →  rank when download completes
```

See [START_HERE.md](./START_HERE.md) for troubleshooting.
