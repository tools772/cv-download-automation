# Perfect Ventures Fetch Agent — Start here

Local app that downloads CVs from **Instahyre** and **Naukri** when you click **Fetch CVs & Rank** in the Caliber portal.

---

## Requirements

- **macOS or Windows** (recruiter laptop)
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Google Chrome** (installed)
- Portal login email (same as Caliber ATS)

---

## First time (once per laptop)

### Option A — Double-click (Mac)

1. Double-click **`Install Fetch Agent.command`**
2. Enter your **portal email** when asked (e.g. `you@perfect.ventures`)
3. Wait for install to finish

### Option B — Terminal

```bash
npm run setup
```

---

## Sign in to job boards (once per laptop, or when session expires)

Open Terminal in this folder, then:

```bash
npm run login-instahyre   # Chrome opens → sign in to Instahyre
npm run login-naukri      # Chrome opens → sign in to Naukri Recruiter
```

Sessions are saved under `~/PerfectVentures/` — not in this folder.

---

## Every day — run the agent

Keep this running while you fetch CVs in the portal.

### Mac — double-click

**`Start Fetch Agent.command`**

### Terminal

```bash
npm start
```

Leave the window open. In the portal: **JD → Upload Resumes → Instahyre or Naukri → Fetch CVs & Rank**.

---

## Config file

`.env.local` in this folder (created by setup):

| Variable | Meaning |
|----------|---------|
| `SUPABASE_URL` | Pre-filled in team package |
| `SUPABASE_ANON_KEY` | Pre-filled in team package |
| `COMPANION_PORTAL_USER_EMAIL` | **Your** Caliber login email |

Edit only if you use a different portal account.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Mac: **“could not be executed… access privileges”** on `.command` file | In Terminal, from this folder: `npm run fix:mac` — or `chmod +x *.command` — or right-click the file → **Open** (first time only) |
| Job stuck on **Queued** | Run `npm start` (or Start Fetch Agent) |
| **Needs Login** in portal | Run `npm run login-instahyre` or `login-naukri`, then Reconnect |
| Wrong jobs picked up | Set `COMPANION_PORTAL_USER_EMAIL` to your portal email, restart agent |
| `Missing SUPABASE_URL` | Run `npm run setup` |

---

## For IT / admin

Build a zip for the team (Supabase pre-filled, recruiter adds email on setup):

```bash
npm run package:recruiter -- --portal-env ../ats-perfect-ventures/.env.local
```

Output: `recruiter/perfect-ventures-fetch-agent-v0.1.0.zip`
