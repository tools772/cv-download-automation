# Desktop installers (.dmg / .exe)

Built by admin — share with recruiters instead of the zip when ready.

| Platform | File (after build) |
|----------|-------------------|
| **macOS** | `installers/Perfect Ventures Fetch Agent-*-arm64.dmg` (Apple Silicon) |
| **Windows** | `installers/Perfect Ventures Fetch Agent Setup *.exe` |

## Build (admin)

Requires Node 18+ and `npm install` in repo root first.

**macOS .dmg** (build on a Mac):

```bash
npm run build:dmg -- --portal-env ../ats-perfect-ventures/.env.local
```

**Windows .exe** — built on GitHub Actions (no Windows laptop needed):

1. Add repo secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` (see [`.github/README.md`](../.github/README.md))
2. **Actions** → **Build Windows installer** → **Run workflow**
3. Download `.exe` from **Artifacts** (or **Releases** if you pushed a `v*` tag)

Local alternative (Windows machine):

```bash
npm run build:exe -- --portal-env ../ats-perfect-ventures/.env.local
```

**Both** (on Mac builds dmg only; on Windows builds exe only):

```bash
npm run build:installers -- --portal-env ../ats-perfect-ventures/.env.local
```

Output folder: **`recruiter/installers/`**

## Recruiter setup (installed app)

1. Install **Google Chrome**
2. Install from `.dmg` (Mac) or `.exe` (Windows)
3. Open **Perfect Ventures Fetch Agent**
4. Enter **Caliber portal email** → Save
5. **Login Instahyre** and **Login Naukri** (once per machine)
6. **Connect Google Drive** in the Caliber portal (browser)
7. Click **Start agent** — keep app open while fetching

No Node.js install required for recruiters using the desktop app.

## Notes

- First launch may show an “unidentified developer” warning (unsigned build) — use **Open** anyway or IT code-signs later.
- Installer size ~300–500 MB (includes Playwright + dependencies).
- Zip package in parent folder remains for IT/scripted installs.
