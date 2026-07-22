# Fetch Agent — Quick start

Runs on your laptop. Downloads CVs from Instahyre/Naukri when you click **Fetch CVs & Rank** in Caliber.

## You need

- Node.js 18+ ([nodejs.org](https://nodejs.org))
- Google Chrome
- Caliber portal login + **Google Drive connected** in the portal

---

## Setup (once)

### Desktop app (recommended — no Node.js)

1. Install from **`Perfect Ventures Fetch Agent.dmg`** (Mac) or **`.exe`** (Windows)
2. Open app → enter portal email → **Login Instahyre** / **Login Naukri**
3. **Start agent**

### Zip + Terminal (alternative)

| Step | Mac | Windows |
|------|-----|---------|
| 1 | Unzip the folder | Unzip the folder |
| 2 | Double-click **Install Fetch Agent.command** | Double-click **install-fetch-agent.bat** |
| 3 | Enter your **portal email** | Enter your **portal email** |
| 4 | Open Terminal → `npm run login-instahyre` | Same in Command Prompt |
| 5 | `npm run login-naukri` | `npm run login-naukri` |

---

## Every day

| Mac | Windows |
|-----|---------|
| Double-click **Start Fetch Agent.command** | Double-click **start-fetch-agent.bat** |
| Keep window open | Keep window open |

Then in Caliber: **JD → Upload Resumes → Instahyre or Naukri → Fetch CVs & Rank**.

---

## Problems?

| Issue | Fix |
|-------|-----|
| Job stuck on Queued | Agent not running — start it |
| Needs Login | Run login script for that site again |
| Mac “access privileges” on `.command` | Right-click → **Open**, or run `npm run fix:mac` in Terminal |

Full guides: **MAC-SETUP.md** / **WINDOWS-SETUP.md** (in this package folder).
