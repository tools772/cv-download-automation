import fs from "fs-extra";
import { instahyreSessionPath, naukriSessionPath, perfectVenturesHome } from "../config.js";

export async function ensurePerfectVenturesDir(): Promise<void> {
  await fs.ensureDir(perfectVenturesHome);
  await fs.ensureDir(pathJoinDownloads());
}

function pathJoinDownloads(): string {
  return `${perfectVenturesHome}/downloads`;
}

export async function hasInstahyreSession(): Promise<boolean> {
  return sessionFileValid(instahyreSessionPath);
}

export async function hasNaukriSession(): Promise<boolean> {
  return sessionFileValid(naukriSessionPath);
}

async function sessionFileValid(filePath: string): Promise<boolean> {
  if (!(await fs.pathExists(filePath))) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.size > 10;
  } catch {
    return false;
  }
}

export function getInstahyreSessionPath(): string {
  return instahyreSessionPath;
}

export function getNaukriSessionPath(): string {
  return naukriSessionPath;
}
