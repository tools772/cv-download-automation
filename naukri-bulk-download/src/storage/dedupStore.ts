import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';

interface DedupIndex {
  hashes: Record<string, { candidateId: string; driveFileId?: string; at: string }>;
}

export class DedupStore {
  private filePath: string;
  private index: DedupIndex = { hashes: {} };

  constructor(config: AppConfig) {
    this.filePath = path.join(config.sessionDir, 'download-hashes.json');
  }

  async load(): Promise<void> {
    if (await fs.pathExists(this.filePath)) {
      this.index = (await fs.readJson(this.filePath)) as DedupIndex;
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.writeJson(this.filePath, this.index, { spaces: 2 });
  }

  has(sha256: string): boolean {
    return sha256 in this.index.hashes;
  }

  get(sha256: string): DedupIndex['hashes'][string] | undefined {
    return this.index.hashes[sha256];
  }

  async record(
    sha256: string,
    candidateId: string,
    driveFileId?: string,
  ): Promise<void> {
    this.index.hashes[sha256] = {
      candidateId,
      driveFileId,
      at: new Date().toISOString(),
    };
    await this.save();
  }
}
