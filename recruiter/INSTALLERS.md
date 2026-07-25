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

**Windows .exe** and **macOS .dmg** — built together via GitHub Actions:

1. Add environment secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the `dev` and `main` GitHub Environments (see [`.github/README.md`](../.github/README.md))
2. Push to `dev`/`main`, or **Actions** → **Build installers** → **Run workflow**
3. Download from **Artifacts**, or push a `v*` tag for a **GitHub Release**

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Local builds:

```bash
npm run dist:mac -- --portal-env ../ats-perfect-ventures/.env.local   # Mac
npm run dist:win -- --portal-env ../ats-perfect-ventures/.env.local   # Windows
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
