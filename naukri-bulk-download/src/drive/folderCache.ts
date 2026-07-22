import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';

interface FolderCacheData {
  folders: Record<string, string>;
}

export class DriveFolderCache {
  private filePath: string;
  private data: FolderCacheData = { folders: {} };

  constructor(config: AppConfig) {
    this.filePath = path.join(config.sessionDir, 'drive-folder-cache.json');
  }

  async load(): Promise<void> {
    if (await fs.pathExists(this.filePath)) {
      this.data = (await fs.readJson(this.filePath)) as FolderCacheData;
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.writeJson(this.filePath, this.data, { spaces: 2 });
  }

  get(key: string): string | undefined {
    return this.data.folders[key];
  }

  async set(key: string, folderId: string): Promise<void> {
    this.data.folders[key] = folderId;
    await this.save();
  }
}

export function dailyFolderKey(baseName: string, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${baseName}/${y}-${m}-${d}`;
}
