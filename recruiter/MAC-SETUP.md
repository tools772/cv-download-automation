# Fetch Agent — macOS setup

## 1. Install Node.js

Download **LTS** from [nodejs.org](https://nodejs.org) and install.

Check in Terminal:

```bash
node -v
```

Should show `v18` or higher.

---

## 2. Unzip the package

Unzip `perfect-ventures-fetch-agent-v0.1.0.zip` to e.g. `~/Documents/perfect-ventures-fetch-agent`.

---

## 3. First-time install

**Option A — double-click**

1. Open the unzipped folder in Finder
2. Double-click **`Install Fetch Agent.command`**
3. If macOS says *“could not be executed… access privileges”*:
   - Right-click the file → **Open** → **Open** again, **or**
   - Terminal: `cd` to the folder, run `npm run fix:mac`
4. Enter your **Caliber portal email** when prompted
5. Wait for `npm install` to finish

**Option B — Terminal**

```bash
cd ~/Documents/perfect-ventures-fetch-agent
npm run install:agent
```

---

## 4. Sign in to job boards (once per laptop)

Open **Terminal** in the fetch agent folder:

```bash
npm run login-instahyre
```

Chrome opens → sign in to Instahyre employer account → close when done.

```bash
npm run login-naukri
```

Chrome opens → sign in to Naukri Recruiter / Resdex → close when done.

Sessions save to `~/PerfectVentures/` (not in the project folder).

---

## 5. Connect Google Drive (in Caliber portal)

In the **Caliber web app** (browser): use **Connect Google Drive** in the header.  
The fetch agent does **not** store Google credentials — the portal passes a token per fetch job.

---

## 6. Start the agent (every time you fetch)

Double-click **`Start Fetch Agent.command`**

Or Terminal:

```bash
npm start
```

**Leave the window open** while fetching.

In Caliber: **JD → Upload Resumes → Instahyre or Naukri → Fetch CVs & Rank**.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `.command` won’t run | `npm run fix:mac` or right-click → Open |
| Job stuck **Queued** | Start Fetch Agent not running |
| **Needs Login** | Run `login-instahyre` or `login-naukri` again |
| Wrong user’s jobs | `.env.local` → set `COMPANION_PORTAL_USER_EMAIL` to your portal email |

---

## Files you use

| File | When |
|------|------|
| `Install Fetch Agent.command` | Once |
| `Start Fetch Agent.command` | Every fetch session |
| `.env.local` | Auto-created; your portal email |
