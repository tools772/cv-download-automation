import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { InstahyreConfig } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** bulk-download-instahyre/ — sessions, logs, downloads */
export const projectRoot = path.resolve(__dirname, '../..');
/** ats-perfect-ventures/ — shared .env */
const repoRoot = path.resolve(projectRoot, '..');

/** Values set before this module loads (e.g. fetch-cvs-server spawn) must beat .env files. */
const preservedEnv = { ...process.env };

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

for (const [key, value] of Object.entries(preservedEnv)) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function resolveGoogleAuthMode(): 'service_account' | 'oauth' {
  const explicit = process.env.GOOGLE_AUTH_MODE?.trim().toLowerCase();
  if (explicit === 'oauth') return 'oauth';
  if (explicit === 'service_account') return 'service_account';

  if (
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_FILE?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_JSON?.trim()
  ) {
    return 'oauth';
  }

  return 'service_account';
}

export function loadConfig(overrides: Partial<InstahyreConfig> = {}): InstahyreConfig {
  const sessionDir =
    process.env.INSTAHYRE_SESSION_DIR?.trim() ||
    process.env.SESSION_DIR?.trim() ||
    'sessions';
  const localSaveDirRaw =
    process.env.INSTAHYRE_LOCAL_SAVE_DIR?.trim() ||
    process.env.LOCAL_SAVE_DIR?.trim();
  const tokenFile =
    process.env.GOOGLE_OAUTH_TOKEN_FILE?.trim() ||
    path.join(sessionDir, 'google-oauth-token.json');

  const headless = parseBool(process.env.HEADLESS, false);
  const manualLoginExplicit = process.env.INSTAHYRE_MANUAL_LOGIN?.trim();
  const manualLogin =
    manualLoginExplicit !== undefined && manualLoginExplicit !== ''
      ? parseBool(manualLoginExplicit, false)
      : !headless;

  const config: InstahyreConfig = {
    email: process.env.INSTAHYRE_EMAIL?.trim() ?? '',
    password: process.env.INSTAHYRE_PASSWORD?.trim() ?? '',
    headless,
    manualLogin,
    manualLoginTimeoutMs:
      Number(process.env.INSTAHYRE_MANUAL_LOGIN_TIMEOUT_MS) || 300_000,
    sessionDir: path.isAbsolute(sessionDir)
      ? sessionDir
      : path.join(projectRoot, sessionDir),
    storageStateFile:
      process.env.INSTAHYRE_STORAGE_STATE_FILE?.trim() ||
      process.env.STORAGE_STATE_FILE?.trim() ||
      'storageState.json',
    loginTimeoutMs: Number(process.env.LOGIN_TIMEOUT_MS) || 120_000,
    sessionValidateTimeoutMs:
      Number(process.env.SESSION_VALIDATE_TIMEOUT_MS) || 60_000,
    instahyreCandidatesUrl:
      process.env.INSTAHYRE_CANDIDATES_URL?.trim() ||
      process.env.INSTAHYRE_SEARCH_URL?.trim() ||
      undefined,
    downloadLimit: Math.max(
      1,
      Number.parseInt(process.env.DOWNLOAD_LIMIT ?? '10', 10) || 10,
    ),
    uploadToDriveAfterDownload: parseBool(
      process.env.UPLOAD_TO_DRIVE_AFTER_DOWNLOAD,
      Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()),
    ),
    googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || undefined,
    googleAuthMode: resolveGoogleAuthMode(),
    googleServiceAccountFile:
      process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim() || undefined,
    googleServiceAccountJson:
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || undefined,
    googleOAuthClientId:
      process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined,
    googleOAuthClientSecret:
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || undefined,
    googleOAuthClientFile:
      process.env.GOOGLE_OAUTH_CLIENT_FILE?.trim() || undefined,
    googleOAuthClientJson:
      process.env.GOOGLE_OAUTH_CLIENT_JSON?.trim() || undefined,
    googleOAuthRedirectUri:
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
      'http://localhost:3000/oauth/callback',
    googleOAuthTokenFile: path.isAbsolute(tokenFile)
      ? tokenFile
      : path.join(projectRoot, tokenFile),
    logLevel: process.env.LOG_LEVEL?.trim() || 'info',
    ...overrides,
  };

  config.localSaveDir = localSaveDirRaw
    ? path.isAbsolute(localSaveDirRaw)
      ? localSaveDirRaw
      : path.join(projectRoot, localSaveDirRaw)
    : path.join(config.sessionDir, 'downloads');

  return config;
}

export function assertCredentials(config: InstahyreConfig, sessionExists = false): void {
  if (sessionExists) return;
  if (config.manualLogin) return;
  if (!config.email) {
    throw new Error('Missing INSTAHYRE_EMAIL in .env (or run with a saved session)');
  }
  if (!config.password) {
    throw new Error('Missing INSTAHYRE_PASSWORD in .env (or run with a saved session)');
  }
}

export function assertDriveUploadConfig(config: InstahyreConfig): void {
  if (!config.uploadToDriveAfterDownload) return;
  if (!config.googleDriveFolderId) {
    throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID for Drive upload.');
  }

  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN?.trim()) {
    return;
  }

  if (config.googleAuthMode === 'oauth') {
    const hasOAuthClient = Boolean(
      (config.googleOAuthClientId && config.googleOAuthClientSecret) ||
        config.googleOAuthClientFile ||
        config.googleOAuthClientJson,
    );
    if (!hasOAuthClient) {
      throw new Error(
        'Drive upload uses OAuth but OAuth client is missing. Set GOOGLE_OAUTH_CLIENT_ID/SECRET or GOOGLE_OAUTH_CLIENT_FILE.',
      );
    }
    return;
  }

  if (!config.googleServiceAccountFile && !config.googleServiceAccountJson) {
    throw new Error(
      'Drive upload uses service account but credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_FILE/JSON, or set GOOGLE_AUTH_MODE=oauth with OAuth credentials.',
    );
  }
}
