import path from 'node:path';

import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import type { AppConfig } from '../types/index.js';



const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** bulk-download/ — sessions, logs, downloads */

export const projectRoot = path.resolve(__dirname, '../..');

/** ats-perfect-ventures/ — shared .env */

const repoRoot = path.resolve(projectRoot, '..');



/** Job-injected vars from fetch agent spawn — must beat .env files. */
const JOB_INJECTED_ENV_KEYS = [
  'RESDEX_SAVED_SEARCH_URL',
  'DOWNLOAD_LIMIT',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_DRIVE_ACCESS_TOKEN',
] as const;

function captureJobInjectedEnv(): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const key of JOB_INJECTED_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) captured[key] = value;
  }
  return captured;
}

/** Values set before this module loads (e.g. fetch-cvs-server spawn) must beat .env files. */
const preservedEnv = { ...process.env };
const jobInjectedEnv = captureJobInjectedEnv();

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

for (const [key, value] of Object.entries(preservedEnv)) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

for (const [key, value] of Object.entries(jobInjectedEnv)) {
  process.env[key] = value;
}



function parseBool(value: string | undefined, defaultValue: boolean): boolean {

  if (value === undefined || value.trim() === '') return defaultValue;

  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());

}



function requireEnv(name: string): string {

  const value = process.env[name]?.trim();

  if (!value) {

    throw new Error(`Missing required environment variable: ${name}`);

  }

  return value;

}



export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {

  const sessionDir =

    process.env.NAUKRI_SESSION_DIR?.trim() ||

    process.env.SESSION_DIR?.trim() ||

    'sessions';

  const storageStateFile =

    process.env.STORAGE_STATE_FILE?.trim() || 'storageState.json';

  const tokenFile =

    process.env.GOOGLE_OAUTH_TOKEN_FILE?.trim() ||

    path.join(sessionDir, 'google-oauth-token.json');



  const config: AppConfig = {

    username: process.env.NAUKRI_USERNAME?.trim() ?? '',

    password: process.env.NAUKRI_PASSWORD?.trim() ?? '',

    headless: parseBool(process.env.HEADLESS, false),

    mobileEmulation: parseBool(process.env.MOBILE_EMULATION, false),

    proxyServer: process.env.PROXY_SERVER?.trim() || undefined,

    sessionDir: path.isAbsolute(sessionDir)

      ? sessionDir

      : path.join(projectRoot, sessionDir),

    storageStateFile,

    loginTimeoutMs: Number(process.env.LOGIN_TIMEOUT_MS) || 120_000,

    sessionValidateTimeoutMs:

      Number(process.env.SESSION_VALIDATE_TIMEOUT_MS) || 60_000,

    recruiterBaseUrl:

      process.env.RECRUITER_BASE_URL?.trim() || 'https://recruit.naukri.com',

    recruiterApiBaseUrl:

      process.env.RECRUITER_API_BASE_URL?.trim() ||

      'https://recruit.naukri.com',

    resdexSavedSearchUrl:

      process.env.RESDEX_SAVED_SEARCH_URL?.trim() || undefined,

    downloadLimit: Math.min(

      50,

      Math.max(

      1,

      Number.parseInt(process.env.DOWNLOAD_LIMIT ?? '10', 10) || 10,

    )),

    downloadStartRank: parseInt(process.env.DOWNLOAD_START_RANK ?? '1', 10),

    downloadEndRank: process.env.DOWNLOAD_END_RANK

    ? parseInt(process.env.DOWNLOAD_END_RANK, 10)

    : undefined,

    googleDriveFolderId:

      process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || undefined,

    uploadToDriveAfterDownload: parseBool(

      process.env.UPLOAD_TO_DRIVE_AFTER_DOWNLOAD,

      Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()),

    ),

    googleAuthMode:

      process.env.GOOGLE_AUTH_MODE?.trim() === 'oauth'

        ? 'oauth'

        : 'service_account',

    googleServiceAccountFile:

      process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim() || undefined,

    googleServiceAccountJson:

      process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || undefined,

    googleOAuthClientId:

      process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||

      process.env.GOOGLE_CLIENT_ID?.trim() ||

      undefined,

    googleOAuthClientSecret:

      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||

      process.env.GOOGLE_CLIENT_SECRET?.trim() ||

      undefined,

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

    enableHarExport: parseBool(process.env.ENABLE_HAR_EXPORT, false),

    enableNetworkLogging: parseBool(process.env.ENABLE_NETWORK_LOGGING, false),

    logLevel: process.env.LOG_LEVEL?.trim() || 'info',

    manualDownloadSave: parseBool(process.env.MANUAL_DOWNLOAD_SAVE, true),

    manualDownloadPauseMs:

      Number.parseInt(process.env.MANUAL_DOWNLOAD_PAUSE_MS ?? '3000', 10) || 3000,

    manualResdexLogin: parseBool(process.env.MANUAL_RESDEX_LOGIN, false),

    ...overrides,

  };



  const localSaveDirRaw =

    process.env.NAUKRI_LOCAL_SAVE_DIR?.trim() ||

    process.env.LOCAL_SAVE_DIR?.trim();

  config.localSaveDir = localSaveDirRaw

    ? path.isAbsolute(localSaveDirRaw)

      ? localSaveDirRaw

      : path.join(projectRoot, localSaveDirRaw)

    : path.join(config.sessionDir, 'downloads');



  if (config.manualDownloadSave && config.headless) {

    config.headless = false;

  }



  return config;

}



export function assertCredentials(config: AppConfig, hasStoredSession = false): void {
  if (hasStoredSession) return;
  if (config.manualResdexLogin) return;
  if (!config.username) {
    throw new Error(
      'Missing NAUKRI_USERNAME in .env (or run npm run login-naukri to save a session)',
    );
  }
  if (!config.password) {
    throw new Error(
      'Missing NAUKRI_PASSWORD in .env (or run npm run login-naukri to save a session)',
    );
  }
}


