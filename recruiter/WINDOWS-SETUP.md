# Fetch Agent — Windows setup

## 1. Install Node.js

Download **LTS** from [nodejs.org](https://nodejs.org) and install (include “Add to PATH”).

Open **Command Prompt** or **PowerShell**:

```cmd
node -v
```

Should show `v18` or higher.

---

## 2. Unzip the package

Unzip `perfect-ventures-fetch-agent-v0.1.0.zip` to e.g. `C:\Users\You\Documents\perfect-ventures-fetch-agent`.

---

## 3. First-time install

1. Open the unzipped folder in File Explorer
2. Double-click **`install-fetch-agent.bat`**
3. Enter your **Caliber portal email** when prompted
4. Wait for `npm install` to finish (several minutes)

**Or in Command Prompt:**

```cmd
cd C:\Users\You\Documents\perfect-ventures-fetch-agent
npm run install:agent
```

---

## 4. Sign in to job boards (once per laptop)

In Command Prompt, from the fetch agent folder:

```cmd
npm run login-instahyre
```

Chrome opens → sign in to Instahyre → close when done.

```cmd
npm run login-naukri
```

Chrome opens → sign in to Naukri Recruiter → close when done.

Sessions save under `C:\Users\You\PerfectVentures\`.

---

## 5. Connect Google Drive (in Caliber portal)

In the **Caliber web app**: **Connect Google Drive** in the header.  
The fetch agent uploads using a token from the portal — no Google setup in this folder.

---

## 6. Start the agent (every time you fetch)

Double-click **`start-fetch-agent.bat`**

Or Command Prompt:

```cmd
npm start
```

**Leave the window open** while fetching.

In Caliber: **JD → Upload Resumes → Instahyre or Naukri → Fetch CVs & Rank**.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `'node' is not recognized` | Reinstall Node.js with “Add to PATH”, restart Command Prompt |
| `'npm' is not recognized` | Same as above |
| Job stuck **Queued** | Agent not running — run `start-fetch-agent.bat` |
| **Needs Login** | Run `npm run login-instahyre` or `login-naukri` again |
| SmartScreen blocked `.bat` | Click **More info** → **Run anyway** (first time only) |

---

## Files you use

| File | When |
|------|------|
| `install-fetch-agent.bat` | Once |
| `start-fetch-agent.bat` | Every fetch session |
| `.env.local` | Auto-created; your portal email |
