import path from "node:path";
import { chromium } from "playwright";
import { ensurePerfectVenturesDir, getNaukriSessionPath } from "../storage/session.js";

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
 * Launch headed Chrome, wait for manual Naukri Recruiter login, save session under ~/PerfectVentures.
 */
export async function connectNaukri(startUrl?: string): Promise<void> {
  await ensurePerfectVenturesDir();

  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  const url = startUrl?.trim() || NAUKRI_LOGIN;
  console.log("\n=== Naukri manual login ===");
  console.log("Sign in to Naukri Recruiter in the Chrome window that opened.");
  console.log(`Opening: ${url}\n`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    if (isLoggedIn(currentUrl) && !isLoginLikePage(currentUrl, bodyText)) {
      // Optional: open Resdex once to ensure recruiter session covers CV download
      if (!/resdex\.naukri\.com/i.test(currentUrl)) {
        await page.goto(RESDEX_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 2000));
      }

      const statePath = getNaukriSessionPath();
      await context.storageState({ path: statePath });
      console.log(`Session saved: ${statePath}`);
      await browser.close();
      return;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await browser.close();
  throw new Error(`Naukri login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
}

export function getNaukriSessionConfig(): { sessionDir: string; storageStateFile: string } {
  return {
    sessionDir: path.dirname(getNaukriSessionPath()),
    storageStateFile: path.basename(getNaukriSessionPath()),
  };
}
