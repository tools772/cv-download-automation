import path from "node:path";
import { chromium } from "playwright";
import { ensurePerfectVenturesDir, getInstahyreSessionPath } from "../storage/session.js";

const INSTAHYRE_LOGIN = "https://www.instahyre.com/login/";
const LOGIN_TIMEOUT_MS = 300_000;

function isEmployerArea(url: string): boolean {
  return /instahyre\.com\/employer/i.test(url);
}

function isLoginLikePage(url: string, bodyText: string): boolean {
  if (/login|signin|sign-in/i.test(url)) return true;
  return /log\s*in to instahyre|sign in to continue|enter your email/i.test(bodyText);
}

export async function connectInstahyre(candidatesUrl?: string): Promise<void> {
  await ensurePerfectVenturesDir();

  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  const startUrl = candidatesUrl?.trim() || INSTAHYRE_LOGIN;
  console.log("\n=== Instahyre login ===");
  console.log("Sign in in the Chrome window that opened.\n");

  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    if (/security verification|not a bot|ray id:/i.test(bodyText)) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (!isLoginLikePage(url, bodyText) && isEmployerArea(url)) {
      const statePath = getInstahyreSessionPath();
      await context.storageState({ path: statePath });
      console.log(`Session saved: ${statePath}`);
      await browser.close();
      return;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await browser.close();
  throw new Error(`Instahyre login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
}

export function getInstahyreSessionConfig(): { sessionDir: string; storageStateFile: string } {
  return {
    sessionDir: path.dirname(getInstahyreSessionPath()),
    storageStateFile: path.basename(getInstahyreSessionPath()),
  };
}
