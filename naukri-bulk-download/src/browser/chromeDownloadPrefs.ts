import path from 'node:path';
import fs from 'fs-extra';

type ChromePrefs = Record<string, unknown>;

/**
 * Seed Chromium profile prefs so downloads show "Save As" instead of silent save / inline PDF.
 */
export async function ensureChromeDownloadPromptProfile(
  profileDir: string,
): Promise<void> {
  const defaultDir = path.join(profileDir, 'Default');
  await fs.ensureDir(defaultDir);

  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs: ChromePrefs = {};

  if (await fs.pathExists(prefsPath)) {
    try {
      prefs = (await fs.readJson(prefsPath)) as ChromePrefs;
    } catch {
      prefs = {};
    }
  }

  const download = (prefs.download as ChromePrefs) ?? {};
  download.prompt_for_download = true;
  download.directory_upgrade = true;
  prefs.download = download;

  const plugins = (prefs.plugins as ChromePrefs) ?? {};
  // Download PDFs instead of opening in Chrome viewer (viewer rarely shows Save As on click).
  plugins.always_open_pdf_externally = true;
  prefs.plugins = plugins;

  await fs.writeJson(prefsPath, prefs, { spaces: 2 });
  await fs.ensureDir(path.join(profileDir, 'Downloads'));
}
