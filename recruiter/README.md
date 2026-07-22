# Recruiter package — upload & share

This folder is for **distribution to recruiters**. Upload the zip below (Google Drive, Slack, etc.).

## Share this file

| File | Purpose |
|------|---------|
| **`perfect-ventures-fetch-agent-v0.1.0.zip`** | CLI install (needs Node.js) |
| **`installers/*.dmg`** | **macOS app** — preferred for Mac recruiters |
| **`installers/*.exe`** | **Windows app** — preferred for Windows recruiters |

See **[INSTALLERS.md](./INSTALLERS.md)** for desktop app setup.

## Optional: attach setup guides

| File | Audience |
|------|----------|
| [MAC-SETUP.md](./MAC-SETUP.md) | macOS recruiters |
| [WINDOWS-SETUP.md](./WINDOWS-SETUP.md) | Windows recruiters |
| [QUICK-START.md](./QUICK-START.md) | One-page summary (both platforms) |

Recruiters can also open **START_HERE.md** inside the zip after unzipping.

---

## Before sharing (admin)

1. Connect **Google Drive** in the Caliber portal (each recruiter does this in their own account).
2. Rebuild the zip if Supabase config changed:

```bash
cd perfect-ventures-fetch-agent
npm run package:recruiter -- --portal-env ../ats-perfect-ventures/.env.local
```

3. Upload from this folder:
   - **Mac recruiters:** `installers/Perfect Ventures Fetch Agent-*.dmg`
   - **Windows recruiters:** `installers/Perfect Ventures Fetch Agent Setup *.exe`
   - **Or zip:** `perfect-ventures-fetch-agent-v*.zip` (requires Node.js)

Build installers:

```bash
npm run build:dmg -- --portal-env ../ats-perfect-ventures/.env.local   # Mac only
```

**Windows .exe + macOS .dmg:** GitHub Actions workflow **`build.yml`** (see [`.github/README.md`](../.github/README.md))

```bash
# Secrets: SUPABASE_URL, SUPABASE_ANON_KEY
# Actions → Build installers → Run workflow
# Or: git tag v0.1.0 && git push origin v0.1.0
```

---

## Recruiter checklist (copy into email)

1. Install [Node.js 18+](https://nodejs.org)
2. Unzip the fetch agent folder
3. **Mac:** double-click `Install Fetch Agent.command` → then `Start Fetch Agent.command`  
   **Windows:** run `install-fetch-agent.bat` → then `start-fetch-agent.bat`
4. Enter your **Caliber portal email** when asked
5. Once: sign in to Instahyre and Naukri (`npm run login-instahyre` / `login-naukri` in Terminal, or ask IT)
6. Keep the agent running while using **Fetch CVs & Rank** in the portal
