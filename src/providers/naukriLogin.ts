import fs from "fs-extra";
import { chromium } from "playwright";
import { ensurePerfectVenturesDir, getNaukriSessionPath } from "../storage/session.js";
import { naukriChromeProfileDir } from "../config.js";

const NAUKRI_LOGIN = "https://www.naukri.com/recruit/login";
const RESDEX_HOME = "https://resdex.naukri.com/v3/";
const LOGIN_TIMEOUT_MS = 300_000;

function isLoginLikePage(url: string, bodyText: string): boolean {
  if (/recruit\/login|RPAuthenticate/i.test(url)) return true;
  if (/enter registered email|enter password|register\/log in/i.test(bodyText)) return true;
  return false;
}

function isLoggedIn(url: string): boolean {
  if (/recruit\/login/i.test(url)) return false;
  if (/resdex\.naukri\.com/i.test(url)) return true;
  if (/recruit\.naukri\.com\/mnr/i.test(url)) return true;
  if (/recruit\.naukri\.com/i.test(url) && !/login/i.test(url)) return true;
  return false;
}

/**
 * Launch headed Chrome with a persistent profile, wait for manual login, save backup storage state.
 */
export async function connectNaukri(startUrl?: string): Promise<void> {
  await ensurePerfectVenturesDir();
  await fs.ensureDir(naukriChromeProfileDir);

  const context = await chromium.launchPersistentContext(naukriChromeProfileDir, {
    headless: false,
    channel: "chrome",
    acceptDownloads: true,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });

  const page = context.pages()[0] ?? (await context.newPage());
  const url = startUrl?.trim() || NAUKRI_LOGIN;

  console.log("\n=== Naukri manual login ===");
  console.log("Sign in to Naukri Recruiter in the Chrome window that opened.");
  console.log(`Profile: ${naukriChromeProfileDir}`);
  console.log(`Opening: ${url}\n`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    if (isLoggedIn(currentUrl) && !isLoginLikePage(currentUrl, bodyText)) {
      if (!/resdex\.naukri\.com/i.test(currentUrl)) {
        await page.goto(RESDEX_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 2000));
      }

      const statePath = getNaukriSessionPath();
      await context.storageState({ path: statePath });
      console.log(`Login saved to Chrome profile: ${naukriChromeProfileDir}`);
      console.log(`Backup session: ${statePath}`);
      await context.close();
      return;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await context.close();
  throw new Error(`Naukri login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
}

export function getNaukriSessionConfig(): { sessionDir: string; storageStateFile: string } {
  return {
    sessionDir: naukriChromeProfileDir,
    storageStateFile: "Default",
  };
}
