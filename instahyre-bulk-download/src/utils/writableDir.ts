import fs from 'fs-extra';

/** Return `preferred` if it can be created and written to, else `fallback`. */
export function resolveWritableDir(preferred: string, fallback: string): string {
  try {
    fs.ensureDirSync(preferred);
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    fs.ensureDirSync(fallback);
    return fallback;
  }
}
