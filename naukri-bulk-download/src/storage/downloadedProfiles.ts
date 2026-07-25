import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';

interface DownloadedEntry {
  name: string;
  firstDownloadedAt: string;
  lastDownloadedAt: string;
  downloadCount: number;
}

interface DownloadedIndex {
  version: 1;
  /** keyed by normalized candidate name */
  names: Record<string, DownloadedEntry>;
}

/** Lowercase, collapse whitespace so "Rohith  B" === "rohith b". */
export function normalizeCandidateName(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Recover a candidate name from a saved resume filename, e.g.
 * "01-Rohith-B.pdf" → "Rohith B". Mirrors how downloads are named
 * (`<rank>-<name-with-hyphens>.<ext>`).
 */
export function candidateNameFromFilename(filename: string): string | undefined {
  const base = filename.replace(/\.[^.]+$/, ''); // drop extension
  const noRank = base.replace(/^\d+[-_]\s*/, ''); // drop leading rank prefix
  const name = noRank.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name.length > 0 ? name : undefined;
}

const RESUME_FILE_RE = /\.(pdf|docx?|rtf)$/i;

/**
 * Persistent record of candidates already downloaded, keyed by name.
 *
 * Naukri Resdex preview URLs carry no stable per-candidate id (only `sid` and a
 * search-scoped `paramString`, both of which rotate every run), so URL-based
 * dedup is impossible. The candidate's display name is the only identifier that
 * survives across runs, so we dedup on that and skip anyone already fetched.
 */
export class DownloadedProfilesHistory {
  private filePath: string;
  private index: DownloadedIndex = { version: 1, names: {} };
  private loaded = false;

  constructor(sessionDir: string) {
    this.filePath = path.join(sessionDir, 'downloaded-profiles.json');
  }

  async load(): Promise<void> {
    try {
      if (await fs.pathExists(this.filePath)) {
        const parsed = (await fs.readJson(this.filePath)) as Partial<DownloadedIndex>;
        this.index = {
          version: 1,
          names: parsed?.names && typeof parsed.names === 'object' ? parsed.names : {},
        };
      }
    } catch {
      // Corrupt/empty history file — start fresh rather than fail the run.
      this.index = { version: 1, names: {} };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.writeJson(this.filePath, this.index, { spaces: 2 });
  }

  size(): number {
    return Object.keys(this.index.names).length;
  }

  has(name: string | undefined | null): boolean {
    const key = normalizeCandidateName(name);
    return key ? key in this.index.names : false;
  }

  /**
   * Seed history from resume files already saved on disk (from runs before
   * dedup existed). Only adds names not already tracked; returns how many were
   * newly seeded so the next run skips them without re-downloading.
   */
  async seedFromDirectories(dirs: string[]): Promise<number> {
    let added = 0;
    const now = new Date().toISOString();
    for (const dir of dirs) {
      let entries: string[];
      try {
        if (!(await fs.pathExists(dir))) continue;
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!RESUME_FILE_RE.test(entry)) continue;
        const name = candidateNameFromFilename(entry);
        const key = normalizeCandidateName(name);
        if (!key || key in this.index.names) continue;
        this.index.names[key] = {
          name: name!,
          firstDownloadedAt: now,
          lastDownloadedAt: now,
          downloadCount: 1,
        };
        added += 1;
      }
    }
    if (added > 0) await this.persist();
    return added;
  }

  async record(name: string | undefined | null): Promise<void> {
    const key = normalizeCandidateName(name);
    if (!key) return;
    const now = new Date().toISOString();
    const existing = this.index.names[key];
    if (existing) {
      existing.lastDownloadedAt = now;
      existing.downloadCount += 1;
    } else {
      this.index.names[key] = {
        name: name!.trim(),
        firstDownloadedAt: now,
        lastDownloadedAt: now,
        downloadCount: 1,
      };
    }
    await this.persist();
  }
}

export function createDownloadedProfilesHistory(config: AppConfig): DownloadedProfilesHistory {
  return new DownloadedProfilesHistory(config.sessionDir);
}
